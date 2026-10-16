import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as store from './db';
import { judge } from './evals/judge';
import { runChecks } from './evals/checks';
import { callTarget, costOf } from './providers';
import { loadTargets } from './targets';
import type { Phase, ResultRow, RunConfig, RunEvent, Target, Task } from './types';
import { buildPrompt, loadWorkload, TASK_TYPES, tasksFor, type Workload } from './workload';

/**
 * Orchestrates a run:
 *   1. Quality phase: every task on every target, one request at a time per
 *      target. These outputs get scored (checks + judge).
 *   2. Load phase: for each concurrency level, fire N requests with that many
 *      in flight, to see how latency and throughput hold up.
 * Results stream into SQLite as they finish; live tokens go out on an
 * in-process bus that the dashboard's race view subscribes to.
 */

const g = globalThis as unknown as { __bakeoffBus?: EventEmitter; __bakeoffAborts?: Map<string, AbortController> };
export const bus: EventEmitter = (g.__bakeoffBus ??= new EventEmitter().setMaxListeners(100));
const aborts: Map<string, AbortController> = (g.__bakeoffAborts ??= new Map());

interface LiveLane { key: string; targetId: string; taskId: string; phase: Phase; text: string; startedAt: number; firstTokenAt: number | null }
const gl = globalThis as unknown as { __bakeoffLanes?: Map<string, Map<string, LiveLane>> };
const lanes: Map<string, Map<string, LiveLane>> = (gl.__bakeoffLanes ??= new Map());

/** What each target is generating right now in a run (empty for runs in another process). */
export function laneSnapshot(runId: string): RunEvent[] {
  return [...(lanes.get(runId)?.values() ?? [])].map((l) => ({ kind: 'lane' as const, runId, ...l }));
}

function emit(e: RunEvent) {
  bus.emit(`run:${e.runId}`, e);
}

export interface Plan {
  warmup: { target: Target; task: Task }[];
  quality: { target: Target; task: Task; repeat: number }[];
  load: { target: Target; task: Task; concurrency: number }[];
}

export function planRun(config: RunConfig, workload: Workload = loadWorkload(), targets: Target[] = loadTargets()): Plan {
  const chosen = config.targetIds.map((id) => targets.find((t) => t.id === id)).filter((t): t is Target => !!t);
  const tasks = tasksFor(workload, config.taskTypes, config.tasksPerType);
  const quality = chosen.flatMap((target) =>
    tasks.flatMap((task) => Array.from({ length: Math.max(1, config.repeats) }, (_, r) => ({ target, task, repeat: r })))
  );
  const load = chosen.flatMap((target) =>
    config.concurrency.flatMap((c) =>
      Array.from({ length: Math.max(c, config.loadRequests) }, (_, i) => ({ target, task: tasks[i % tasks.length]!, concurrency: c }))
    )
  );
  const warmup = tasks.length ? chosen.map((target) => ({ target, task: tasks[0]! })) : [];
  return { warmup, quality: tasks.length ? quality : [], load: tasks.length ? load : [] };
}

export function startRun(config: RunConfig): string {
  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
  const plan = planRun(config);
  store.createRun(id, config, plan.warmup.length + plan.quality.length + plan.load.length);
  void execute(id, config, plan);
  return id;
}

export function cancelRun(id: string): boolean {
  const ac = aborts.get(id);
  if (!ac) return false;
  ac.abort();
  return true;
}

/** Run with at most `limit` promises in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, signal: AbortSignal) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function callOnce(runId: string, target: Target, task: Task, workload: Workload, phase: Phase, concurrency: number, repeat: number, signal: AbortSignal): Promise<ResultRow> {
  const key = randomUUID();
  const live = phase !== 'load';
  const startedAt = Date.now();
  if (live) {
    emit({ kind: 'start', runId, key, targetId: target.id, taskId: task.id, phase, concurrency });
    if (!lanes.has(runId)) lanes.set(runId, new Map());
    lanes.get(runId)!.set(target.id, { key, targetId: target.id, taskId: task.id, phase, text: '', startedAt, firstTokenAt: null });
  }
  const maxTokens = target.maxTokens ?? TASK_TYPES[task.type].maxTokens;
  let row: Omit<ResultRow, 'id' | 'humanScore' | 'judgeScore' | 'judgeRationale'>;
  try {
    const res = await callTarget(target, buildPrompt(task, workload), {
      maxTokens,
      signal,
      onToken: live
        ? (text) => {
            const lane = lanes.get(runId)?.get(target.id);
            if (lane && lane.key === key) {
              lane.text = (lane.text + text).slice(-4000);
              lane.firstTokenAt ??= Date.now();
            }
            emit({ kind: 'token', runId, key, targetId: target.id, text });
          }
        : undefined,
    });
    const { checks, score } = runChecks(task, res.text);
    const genMs = res.ttftMs != null ? res.totalMs - res.ttftMs : res.totalMs;
    row = {
      runId, targetId: target.id, taskId: task.id, taskType: task.type, phase, concurrency, repeat, startedAt,
      ttftMs: res.ttftMs, totalMs: res.totalMs,
      inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, cacheReadTokens: res.usage.cacheReadTokens,
      tokensPerSec: res.usage.outputTokens > 0 && genMs > 0 ? res.usage.outputTokens / (genMs / 1000) : null,
      costUsd: costOf(target, res.usage, res.reportedCostUsd),
      ok: true, error: null, output: res.text, checks, checkScore: score,
    };
  } catch (e) {
    row = {
      runId, targetId: target.id, taskId: task.id, taskType: task.type, phase, concurrency, repeat, startedAt,
      ttftMs: null, totalMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      tokensPerSec: null, costUsd: null, ok: false, error: signal.aborted ? 'Cancelled' : (e as Error).message, output: null,
      checks: [], checkScore: 0,
    };
  }
  if (live && lanes.get(runId)?.get(target.id)?.key === key) lanes.get(runId)!.delete(target.id);
  const saved = store.insertResult(row);
  emit({ kind: 'done', runId, key, result: saved });
  return saved;
}

async function execute(runId: string, config: RunConfig, plan: Plan) {
  const ac = new AbortController();
  aborts.set(runId, ac);
  const workload = loadWorkload();
  const targets = loadTargets();
  const judgeTarget = config.judge.enabled ? targets.find((t) => t.id === config.judge.targetId) : undefined;
  const total = plan.warmup.length + plan.quality.length + plan.load.length;
  let completed = 0;
  const tick = () => emit({ kind: 'progress', runId, completed: ++completed, total });

  // Judging runs alongside the calls, two at a time, so it's mostly done by the time the calls are.
  const judgeQueue: { result: ResultRow; task: Task }[] = [];
  let judging = 0;
  let judgeDone: () => void = () => {};
  const judgeIdle = () => (judgeQueue.length === 0 && judging === 0 ? Promise.resolve() : new Promise<void>((r) => (judgeDone = r)));
  const pumpJudge = () => {
    while (judgeTarget && judging < 2 && judgeQueue.length && !ac.signal.aborted) {
      const { result, task } = judgeQueue.shift()!;
      judging++;
      judge(task, result.output ?? '', workload, judgeTarget)
        .then((j) => {
          store.setJudgement(result.id, j.score, j.rationale);
          emit({ kind: 'judged', runId, resultId: result.id, score: j.score, rationale: j.rationale });
        })
        .catch((e: Error) => store.setJudgement(result.id, null, `Judge failed: ${e.message}`))
        .finally(() => {
          judging--;
          pumpJudge();
          if (judgeQueue.length === 0 && judging === 0) judgeDone();
        });
    }
  };

  try {
    store.setRunStatus(runId, 'running');
    emit({ kind: 'status', runId, status: 'running' });

    const byTarget = new Map<string, Plan['quality']>();
    for (const job of plan.quality) byTarget.set(job.target.id, [...(byTarget.get(job.target.id) ?? []), job]);

    const runLane = async (jobs: Plan['quality']) => {
      // First request per target warms it up (model load, connection, CLI cache) and is reported as cold start, not counted in the stats.
      const warm = plan.warmup.find((w) => w.target.id === jobs[0]?.target.id);
      if (warm && !ac.signal.aborted) {
        await callOnce(runId, warm.target, warm.task, workload, 'warmup', 1, 0, ac.signal);
        tick();
      }
      for (const job of jobs) {
        if (ac.signal.aborted) return;
        const r = await callOnce(runId, job.target, job.task, workload, 'quality', 1, job.repeat, ac.signal);
        tick();
        if (r.ok && judgeTarget) {
          judgeQueue.push({ result: r, task: job.task });
          pumpJudge();
        }
      }
    };
    if (config.parallelTargets) await Promise.all([...byTarget.values()].map(runLane));
    else for (const jobs of byTarget.values()) await runLane(jobs);

    // Load phase: one target and one concurrency level at a time, so levels don't contaminate each other.
    const groups = new Map<string, Plan['load']>();
    for (const job of plan.load) groups.set(`${job.target.id}|${job.concurrency}`, [...(groups.get(`${job.target.id}|${job.concurrency}`) ?? []), job]);
    for (const jobs of groups.values()) {
      if (ac.signal.aborted) break;
      const c = jobs[0]!.concurrency;
      emit({ kind: 'status', runId, status: 'running', detail: `Load test: ${jobs[0]!.target.label} at ${c} concurrent` });
      await pool(jobs, c, async (job) => {
        await callOnce(runId, job.target, job.task, workload, 'load', c, 0, ac.signal);
        tick();
      }, ac.signal);
    }

    if (judgeTarget && !ac.signal.aborted) {
      store.setRunStatus(runId, 'judging');
      emit({ kind: 'status', runId, status: 'judging' });
      await judgeIdle();
    }

    const status = ac.signal.aborted ? 'cancelled' : 'done';
    store.setRunStatus(runId, status);
    emit({ kind: 'status', runId, status });
  } catch (e) {
    store.setRunStatus(runId, 'failed', (e as Error).message);
    emit({ kind: 'status', runId, status: 'failed', detail: (e as Error).message });
  } finally {
    aborts.delete(runId);
    lanes.delete(runId);
  }
}

/** For the CLI: run in the foreground and resolve when done. */
export function runAndWait(config: RunConfig, onEvent?: (e: RunEvent) => void): Promise<string> {
  const id = startRun(config);
  return new Promise((resolve) => {
    const listener = (e: RunEvent) => {
      onEvent?.(e);
      if (e.kind === 'status' && ['done', 'failed', 'cancelled'].includes(e.status)) {
        bus.off(`run:${id}`, listener);
        resolve(id);
      }
    };
    bus.on(`run:${id}`, listener);
  });
}
