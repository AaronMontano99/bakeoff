import { describe, expect, it } from 'vitest';
import { bootstrapMean, decide, defaultPolicy, rng } from '@/core/decide';
import type { ResultRow, Target, Task, TaskType } from '@/core/types';
import { loadWorkload } from '@/core/workload';

const target = (id: string, over: Partial<Target> = {}): Target => ({
  id,
  label: id,
  provider: 'openai-compatible',
  vendor: 'V',
  model: 'm',
  deployment: 'serverless',
  pricing: { inputPerMTok: 1, outputPerMTok: 4 },
  enabled: true,
  ...over,
});

let nextId = 1;
const row = (over: Partial<ResultRow>): ResultRow => ({
  id: nextId++,
  runId: 'r',
  targetId: 'a',
  taskId: 'x',
  taskType: 'debrief',
  phase: 'quality',
  concurrency: 1,
  repeat: 0,
  startedAt: 0,
  ttftMs: 100,
  totalMs: 1000,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  tokensPerSec: 50,
  costUsd: 0.001,
  ok: true,
  error: null,
  output: '{}',
  checks: [],
  checkScore: 1,
  judgeScore: 5,
  judgeRationale: null,
  humanScore: null,
  ...over,
});

const task = (id: string, type: TaskType, split: 'dev' | 'holdout'): Task => ({
  id,
  type,
  split,
  title: id,
  account: { company: 'C', city: 'X', industry: 'I', employees: '1', contact: { name: 'A B', title: 'T' }, crmNotes: '', research: '' },
});

/** n dev + n holdout debrief tasks, each answered by every target with the given scores. */
function world(n: number, scores: Record<string, { check: number; judge: number; cost: number; holdCheck?: number }>) {
  const tasks: Task[] = [];
  const rows: ResultRow[] = [];
  for (const split of ['dev', 'holdout'] as const) {
    for (let i = 0; i < n; i++) {
      const id = `${split}-${i}`;
      tasks.push(task(id, 'debrief', split));
      for (const [targetId, s] of Object.entries(scores)) {
        const check = split === 'holdout' && s.holdCheck != null ? s.holdCheck : s.check;
        rows.push(row({ targetId, taskId: id, checkScore: check, judgeScore: s.judge, costUsd: s.cost }));
      }
    }
  }
  return { tasks, rows };
}

describe('bootstrap', () => {
  it('is reproducible with a seed and brackets the mean', () => {
    const xs = [0.6, 0.7, 0.8, 0.9, 1];
    const a = bootstrapMean(xs, 1000, 0.9, rng(1))!;
    const b = bootstrapMean(xs, 1000, 0.9, rng(1))!;
    expect(a).toEqual(b);
    expect(a.estimate).toBeCloseTo(0.8);
    expect(a.low).toBeLessThan(0.8);
    expect(a.high).toBeGreaterThan(0.8);
  });

  it('has zero width when every task scores the same', () => {
    expect(bootstrapMean([0.9, 0.9, 0.9], 200, 0.9, rng(2))).toEqual({ estimate: 0.9, low: 0.9, high: 0.9 });
  });
});

describe('decide', () => {
  const targets = [target('cheap'), target('best')];

  it('passes when the cheap pick matches the baseline on holdout', () => {
    const { tasks, rows } = world(6, { cheap: { check: 0.97, judge: 5, cost: 0.001 }, best: { check: 1, judge: 5, cost: 0.01 } });
    const d = decide(rows, tasks, targets);
    expect(d.baselineTargetId).toBe('best');
    expect(d.jobs[0]!.pick?.targetId).toBe('cheap');
    expect(d.jobs[0]!.pick?.confidence).toBe('confident');
    expect(d.verdict).toBe('pass');
    expect(d.savingsPct).toBeCloseTo(0.9);
  });

  it('fails when the pick collapses on holdout, even though it looked fine on dev', () => {
    const { tasks, rows } = world(6, { cheap: { check: 0.95, judge: 5, cost: 0.001, holdCheck: 0.4 }, best: { check: 1, judge: 5, cost: 0.01 } });
    const d = decide(rows, tasks, targets);
    expect(d.jobs[0]!.pick?.targetId).toBe('cheap');
    expect(d.verdict).toBe('fail');
    expect(d.holdout[0]!.held).toBe(false);
    expect(d.checksDelta!.estimate).toBeLessThan(-0.5);
  });

  it('marks a pick tentative when the average clears the bar but the interval does not', () => {
    const tasks: Task[] = [];
    const rows: ResultRow[] = [];
    const checks = [1, 1, 1, 0.3, 1, 1];
    checks.forEach((c, i) => {
      tasks.push(task(`d${i}`, 'debrief', 'dev'));
      rows.push(row({ targetId: 'cheap', taskId: `d${i}`, checkScore: c, judgeScore: c === 1 ? 5 : 2 }));
    });
    const d = decide(rows, tasks, [target('cheap')]);
    expect(d.jobs[0]!.candidates[0]!.confidence).toBe('tentative');
    expect(d.jobs[0]!.pick?.targetId).toBe('cheap');
  });

  it('refuses to judge without holdout rows', () => {
    const { tasks, rows } = world(4, { cheap: { check: 1, judge: 5, cost: 0.001 }, best: { check: 1, judge: 5, cost: 0.01 } });
    const devOnly = rows.filter((r) => r.taskId.startsWith('dev'));
    expect(decide(devOnly, tasks, targets).verdict).toBe('not-enough-data');
  });

  it('never uses a local model as the baseline', () => {
    const { tasks, rows } = world(4, { cheap: { check: 1, judge: 5, cost: 0 }, best: { check: 0.95, judge: 5, cost: 0.01 } });
    const d = decide(rows, tasks, [target('cheap', { deployment: 'local' }), target('best')]);
    expect(d.baselineTargetId).toBe('best');
  });

  it('changes the fingerprint when the picks change', () => {
    const a = world(4, { cheap: { check: 1, judge: 5, cost: 0.001 }, best: { check: 1, judge: 5, cost: 0.01 } });
    const b = world(4, { cheap: { check: 0.2, judge: 1, cost: 0.001 }, best: { check: 1, judge: 5, cost: 0.01 } });
    expect(decide(a.rows, a.tasks, targets).fingerprint).not.toBe(decide(b.rows, b.tasks, targets).fingerprint);
  });
});

describe('workload splits', () => {
  it('keeps 6 dev and 6 holdout tasks per job, and dev tasks first so short runs never touch holdout', () => {
    const w = loadWorkload();
    for (const t of ['signal', 'debrief', 'email', 'callcard'] as const) {
      const mine = w.tasks.filter((x) => x.type === t);
      expect(mine.filter((x) => x.split === 'dev')).toHaveLength(6);
      expect(mine.filter((x) => x.split === 'holdout')).toHaveLength(6);
      expect(mine.slice(0, 6).every((x) => x.split === 'dev')).toBe(true);
    }
  });

  it('balances the ground-truth labels across the split', () => {
    const w = loadWorkload();
    const labels = (split: string) => w.tasks.filter((x) => x.type === 'signal' && x.split === split).map((x) => x.gold!.signalStatus).sort();
    expect(labels('holdout')).toEqual(labels('dev'));
  });
});
