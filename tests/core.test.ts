import { describe, expect, it } from 'vitest';
import { businessCase, calibration, crossover, defaultCaseInputs, loadCurve, paretoFrontier, quality, summarize } from '@/core/analysis';
import { runChecks, words } from '@/core/evals/checks';
import { extractJson } from '@/core/json';
import { costOf } from '@/core/providers';
import { planRun } from '@/core/runner';
import { percentile, spearman } from '@/core/stats';
import type { ResultRow, RunConfig, Target, Task } from '@/core/types';
import { buildPrompt, loadWorkload } from '@/core/workload';

const target = (over: Partial<Target> = {}): Target => ({
  id: 't',
  label: 'T',
  provider: 'openai-compatible',
  vendor: 'V',
  model: 'm',
  deployment: 'serverless',
  pricing: { inputPerMTok: 1, outputPerMTok: 4 },
  enabled: true,
  ...over,
});

let nextId = 1;
const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  id: nextId++,
  runId: 'r',
  targetId: 'a',
  taskId: 'x',
  taskType: 'signal',
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

describe('stats', () => {
  it('interpolates percentiles like numpy', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55);
  });
  it('computes spearman with ties', () => {
    expect(spearman([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 2], [1, 2, 3])).not.toBeNull();
  });
});

describe('json extraction', () => {
  it('handles fences and chatter', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n``` hope that helps')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a": {"b": 2}} suffix')).toEqual({ a: { b: 2 } });
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('cost model', () => {
  it('prices uncached input, cache reads and output separately', () => {
    const t = target({ pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 } });
    const c = costOf(t, { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 1500, cacheWriteTokens: 0 });
    // 500 uncached * 2 + 1500 cached * 0.2 + 500 out * 10, per million
    expect(c).toBeCloseTo((500 * 2 + 1500 * 0.2 + 500 * 10) / 1e6);
  });
  it('returns null for unpriced, 0 for local, reported for subscription', () => {
    const u = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costOf(target({ pricing: { inputPerMTok: null, outputPerMTok: null } }), u)).toBeNull();
    expect(costOf(target({ deployment: 'local' }), u)).toBe(0);
    expect(costOf(target({ deployment: 'subscription' }), u, 0.0123)).toBe(0.0123);
  });
});

describe('deterministic checks', () => {
  const workload = loadWorkload();
  const byId = (id: string) => workload.tasks.find((t) => t.id === id)!;

  it('grades signal labels against ground truth', () => {
    const task = byId('signal-coyote-creek');
    const good = runChecks(task, JSON.stringify({ signalStatus: 'HARD SIGNAL', whyNow: 'They are opening a second facility in Fremont and hiring IT.', evidence: '2026-09-22 press release' }));
    expect(good.score).toBe(1);
    const bad = runChecks(task, JSON.stringify({ signalStatus: 'SOFT SIGNAL', whyNow: 'Maybe growing a bit, worth a call.', evidence: '' }));
    expect(bad.checks.find((c) => c.id === 'signal-label')!.pass).toBe(false);
  });

  it('fails unparseable output on json and contract', () => {
    const r = runChecks(byId('signal-baylight'), 'I think this is a soft signal.');
    expect(r.checks.find((c) => c.id === 'json')!.pass).toBe(false);
    expect(r.checks.find((c) => c.id === 'contract')!.pass).toBe(false);
  });

  it('enforces email rules', () => {
    const task = byId('email-coyote-creek');
    const body = `Hi Dan,\n\nSaw the Fremont facility is opening in Q1 and that you're hiring someone to stand up network and security for it. ${'Getting a second site live on time usually comes down to who owns the network cutover. '.repeat(1)}\n\nIs that sitting with the new hire, or with an outside partner? If it's still open, would 15 minutes next week be worth it?\n\nAaron`;
    const r = runChecks(task, JSON.stringify({ subject: 'fremont site network', body, ctaType: 'meeting' }));
    const n = words(body);
    expect(r.checks.find((c) => c.id === 'length')!.pass).toBe(n >= 60 && n <= 100);
    expect(r.checks.find((c) => c.id === 'em-dash')!.pass).toBe(true);
    const dashed = runChecks(task, JSON.stringify({ subject: 'hello!', body: body.replace('Fremont', 'Fremont — new'), ctaType: 'meeting' }));
    expect(dashed.checks.find((c) => c.id === 'em-dash')!.pass).toBe(false);
    expect(dashed.checks.find((c) => c.id === 'exclaim')!.pass).toBe(false);
  });

  it('checks debrief outcome and meeting flags', () => {
    const task = byId('debrief-mission-peak-booked');
    const r = runChecks(task, JSON.stringify({ outcome: 'meeting_booked', meetingAsked: true, meetingBooked: true, summary: 's', nextStep: 'n', crmNotes: ['a'] }));
    expect(r.score).toBe(1);
  });
});

describe('prompts', () => {
  it('keeps the playbook byte-identical across tasks so it can be cached', () => {
    const w = loadWorkload();
    const a = buildPrompt(w.tasks[0]!, w);
    const b = buildPrompt(w.tasks[10]!, w);
    expect(a.playbook).toBe(b.playbook);
    expect(a.playbook.length).toBeGreaterThan(4000);
    expect(a.user).not.toBe(b.user);
  });
});

describe('run planning', () => {
  it('plans warm-up, quality and load requests', () => {
    const config: RunConfig = {
      name: 'x',
      targetIds: ['a', 'b'],
      taskTypes: ['signal', 'email'],
      tasksPerType: 2,
      repeats: 2,
      concurrency: [1, 4],
      loadRequests: 3,
      parallelTargets: true,
      judge: { enabled: false, targetId: '' },
    };
    const plan = planRun(config, loadWorkload(), [target({ id: 'a' }), target({ id: 'b' })]);
    expect(plan.warmup).toHaveLength(2);
    expect(plan.quality).toHaveLength(2 * 2 * 2 * 2);
    // per target: level 1 -> max(1,3)=3, level 4 -> max(4,3)=4
    expect(plan.load).toHaveLength(2 * (3 + 4));
  });
});

describe('analysis', () => {
  it('scores composite quality and penalizes failures', () => {
    expect(quality(1, 5)).toBe(1);
    expect(quality(0.5, 3)).toBeCloseTo(0.5);
    expect(quality(0.8, null)).toBe(0.8);
    const s = summarize([row(), row({ ok: false, checkScore: 0, judgeScore: null })], ['a'])[0]!;
    expect(s.okRate).toBe(0.5);
    expect(s.quality).toBeCloseTo(0.5);
  });

  it('excludes warm-up from stats and reports it as cold start', () => {
    const s = summarize([row({ phase: 'warmup', totalMs: 9000 }), row({ totalMs: 1000 })], ['a'])[0]!;
    expect(s.coldStartMs).toBe(9000);
    expect(s.totalP95).toBe(1000);
  });

  it('finds the pareto frontier', () => {
    const f = paretoFrontier([
      { id: 'cheap', cost: 0.001, quality: 0.7 },
      { id: 'best', cost: 0.01, quality: 0.95 },
      { id: 'dominated', cost: 0.02, quality: 0.8 },
    ]);
    expect([...f].sort()).toEqual(['best', 'cheap']);
  });

  it('routes each job to the cheapest target that clears the bar', () => {
    const results = [
      row({ targetId: 'small', taskType: 'signal', costUsd: 0.0001, checkScore: 1, judgeScore: 5, totalMs: 800 }),
      row({ targetId: 'small', taskType: 'callcard', costUsd: 0.0002, checkScore: 0.4, judgeScore: 2, totalMs: 3000 }),
      row({ targetId: 'big', taskType: 'signal', costUsd: 0.002, checkScore: 1, judgeScore: 5, totalMs: 1500 }),
      row({ targetId: 'big', taskType: 'callcard', costUsd: 0.01, checkScore: 1, judgeScore: 5, totalMs: 9000 }),
    ];
    const targets = [target({ id: 'small', label: 'Small' }), target({ id: 'big', label: 'Big' })];
    const bc = businessCase(summarize(results, ['small', 'big']), targets, defaultCaseInputs());
    expect(bc.routes.find((r) => r.taskType === 'signal')!.pick!.targetId).toBe('small');
    expect(bc.routes.find((r) => r.taskType === 'callcard')!.pick!.targetId).toBe('big');
    expect(bc.baselineTargetId).toBe('big');
    expect(bc.savingsPct!).toBeGreaterThan(0);
  });

  it('computes load curves from wall time', () => {
    const rows = [0, 1, 2, 3].map((i) => row({ phase: 'load', concurrency: 2, startedAt: Math.floor(i / 2) * 1000, totalMs: 1000, outputTokens: 50 }));
    const [l] = loadCurve(rows);
    expect(l!.requestsPerSec).toBeCloseTo(2);
    expect(l!.outputTokensPerSec).toBeCloseTo(100);
  });

  it('finds the dedicated break-even volume', () => {
    const t = target({ id: 'a', dedicated: { hourlyUsd: 2 } });
    const x = crossover(t, 0.001, [{ targetId: 'a', concurrency: 8, n: 8, errorRate: 0, totalP50: 1, totalP95: 1, ttftP95: 1, requestsPerSec: 4, outputTokensPerSec: 400 }], 10_000)!;
    expect(x.breakEvenMonthly).toBeCloseTo((2 * 730) / 0.001);
  });

  it('measures judge agreement with humans', () => {
    const c = calibration([row({ judgeScore: 5, humanScore: 5 }), row({ judgeScore: 4, humanScore: 2 }), row({ judgeScore: 3, humanScore: 3 })]);
    expect(c.n).toBe(3);
    expect(c.exact).toBeCloseTo(2 / 3);
    expect(c.withinOne).toBeCloseTo(2 / 3);
    expect(c.bias).toBeCloseTo(2 / 3);
  });
});
