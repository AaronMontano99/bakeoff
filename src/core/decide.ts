import { quality, stats } from './analysis';
import { mean, percentile, sum } from './stats';
import type { ResultRow, Target, Task, TaskType } from './types';
import { TASK_TYPE_ORDER, TASK_TYPES } from './workload/meta';

/**
 * The decision engine. The business case answers "what looks cheapest on the
 * numbers we have". This answers the harder question: "is that pick real, or
 * did we get lucky on a handful of tasks?"
 *
 * 1. Pick a model per job using dev tasks only, under explicit constraints.
 *    A pick is "confident" when the lower end of a bootstrap interval on its
 *    quality still clears the bar, not just the average.
 * 2. Freeze the picks (a fingerprint goes in the report).
 * 3. Score the frozen picks on holdout tasks nobody tuned against, next to
 *    "just use the best single model for everything".
 * 4. Pass only if routing costs less AND we can rule out a quality loss bigger
 *    than the margin, on the composite score and on the deterministic checks
 *    alone (the checks are the judge that isn't a model).
 */

export interface Policy {
  /** Minimum composite quality (0-1) per job. */
  qualityBar: number;
  sloMs: Record<TaskType, number>;
  minOkRate: number;
  /** Largest quality drop vs the baseline we'd accept, in quality points (0-1). */
  margin: number;
  /** Two-sided interval level, e.g. 0.9 → the 5th percentile is the lower bound. */
  confidence: number;
  resamples: number;
  seed: number;
  /** Monthly requests per job, to weight cost and quality the way traffic would. */
  monthlyVolume: Record<TaskType, number>;
}

export function defaultPolicy(): Policy {
  const sloMs = {} as Record<TaskType, number>;
  const monthlyVolume = {} as Record<TaskType, number>;
  for (const t of TASK_TYPE_ORDER) {
    sloMs[t] = TASK_TYPES[t].defaultSloMs;
    monthlyVolume[t] = 10 * 21 * TASK_TYPES[t].defaultPerRepPerDay;
  }
  return { qualityBar: 0.8, sloMs, minOkRate: 0.95, margin: 0.05, confidence: 0.9, resamples: 2000, seed: 7, monthlyVolume };
}

export type Confidence = 'confident' | 'tentative' | 'fails';

export interface Candidate {
  targetId: string;
  n: number;
  quality: number | null;
  qualityLow: number | null;
  qualityHigh: number | null;
  checksOnly: number | null;
  p95: number | null;
  okRate: number;
  costPerRequest: number | null;
  confidence: Confidence;
  eligible: boolean;
  why: string[];
}

export interface JobDecision {
  taskType: TaskType;
  candidates: Candidate[];
  pick: Candidate | null;
}

export interface HoldoutSide {
  targetId: string;
  n: number;
  quality: number | null;
  checksOnly: number | null;
  p95: number | null;
  costPerRequest: number | null;
}

export interface JobHoldout {
  taskType: TaskType;
  pick: HoldoutSide;
  baseline: HoldoutSide;
  /** The pick still cleared the bar and the latency budget on unseen tasks. */
  held: boolean;
  why: string[];
}

export interface Interval {
  estimate: number;
  low: number;
  high: number;
}

export type Verdict = 'pass' | 'fail' | 'no-change' | 'not-enough-data';

export interface Decision {
  policy: Policy;
  /** Short hash of the dev picks; if it changes between reports, the decision changed. */
  fingerprint: string;
  baselineTargetId: string | null;
  jobs: JobDecision[];
  holdout: JobHoldout[];
  /** Volume-weighted quality of routing minus baseline on holdout. Negative = routing is worse. */
  qualityDelta: Interval | null;
  checksDelta: Interval | null;
  routedMonthly: number | null;
  baselineMonthly: number | null;
  savingsPct: number | null;
  verdict: Verdict;
  reasons: string[];
  devTasks: number;
  holdoutTasks: number;
}

// ---------------------------------------------------------------- helpers

/** Small seeded PRNG so a report is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap of the mean. */
export function bootstrapMean(xs: number[], resamples: number, confidence: number, rand: () => number): Interval | null {
  if (!xs.length) return null;
  const means: number[] = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]!;
    means.push(s / xs.length);
  }
  const tail = ((1 - confidence) / 2) * 100;
  return { estimate: mean(xs)!, low: percentile(means, tail)!, high: percentile(means, 100 - tail)! };
}

function rowQuality(r: ResultRow): number {
  return r.ok ? (quality(r.checkScore, r.judgeScore) ?? 0) : 0;
}

function rowChecks(r: ResultRow): number {
  return r.ok ? (r.checkScore ?? 0) : 0;
}

/** One score per task (repeats averaged), so the bootstrap resamples tasks, not lucky retries. */
function perTask(rows: ResultRow[], score: (r: ResultRow) => number): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.taskId, [...(by.get(r.taskId) ?? []), score(r)]);
  return new Map([...by].map(([k, v]) => [k, mean(v)!]));
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- decide

export function decide(results: ResultRow[], tasks: Task[], targets: Target[], policy: Policy = defaultPolicy()): Decision {
  const split = new Map(tasks.map((t) => [t.id, t.split ?? 'dev']));
  const quality = results.filter((r) => r.phase === 'quality');
  const dev = quality.filter((r) => split.get(r.taskId) === 'dev');
  const hold = quality.filter((r) => split.get(r.taskId) === 'holdout');
  const deployment = (id: string) => targets.find((t) => t.id === id)?.deployment;
  const targetIds = [...new Set(quality.map((r) => r.targetId))];
  const rand = rng(policy.seed);

  const jobs: JobDecision[] = [];
  for (const t of TASK_TYPE_ORDER) {
    const candidates: Candidate[] = [];
    for (const id of targetIds) {
      const rows = dev.filter((r) => r.targetId === id && r.taskType === t);
      if (!rows.length) continue;
      const st = stats(rows);
      const q = bootstrapMean([...perTask(rows, rowQuality).values()], policy.resamples, policy.confidence, rand);
      const why: string[] = [];
      let confidence: Confidence = 'fails';
      if (q && q.low >= policy.qualityBar) confidence = 'confident';
      else if (q && q.estimate >= policy.qualityBar) confidence = 'tentative';
      if (confidence === 'fails') why.push(`quality ${q ? Math.round(q.estimate * 100) : 'n/a'} under the ${Math.round(policy.qualityBar * 100)} bar`);
      if (confidence === 'tentative') why.push(`average clears the bar but the low end (${Math.round(q!.low * 100)}) doesn't`);
      if (st.totalP95 == null || st.totalP95 > policy.sloMs[t]) why.push(`p95 ${st.totalP95 == null ? 'n/a' : (st.totalP95 / 1000).toFixed(1) + 's'} over the ${(policy.sloMs[t] / 1000).toFixed(0)}s budget`);
      if (st.okRate < policy.minOkRate) why.push(`${Math.round((1 - st.okRate) * 100)}% of requests failed`);
      if (st.costPerRequest == null) why.push('no price');
      candidates.push({
        targetId: id,
        n: new Set(rows.map((r) => r.taskId)).size,
        quality: q?.estimate ?? null,
        qualityLow: q?.low ?? null,
        qualityHigh: q?.high ?? null,
        checksOnly: mean([...perTask(rows, rowChecks).values()]),
        p95: st.totalP95,
        okRate: st.okRate,
        costPerRequest: st.costPerRequest,
        confidence,
        // Tentative picks are allowed, but they're flagged and the holdout has to carry them.
        eligible: why.every((w) => w.startsWith('average clears')),
        why,
      });
    }
    if (!candidates.length) continue;
    const rank = (c: Candidate) => (c.confidence === 'confident' ? 0 : 1);
    const pick =
      candidates
        .filter((c) => c.eligible)
        .sort((a, b) => rank(a) - rank(b) || (a.costPerRequest ?? 0) - (b.costPerRequest ?? 0) || (b.quality ?? 0) - (a.quality ?? 0))[0] ?? null;
    jobs.push({ taskType: t, candidates, pick });
  }

  // Baseline: the single best priced, non-local model on dev, used for every job.
  const overall = targetIds
    .filter((id) => deployment(id) !== 'local')
    .map((id) => ({ id, st: stats(dev.filter((r) => r.targetId === id)) }))
    .filter((x) => x.st.costPerRequest != null && x.st.quality != null)
    .sort((a, b) => (b.st.quality ?? 0) - (a.st.quality ?? 0) || (a.st.costPerRequest ?? 0) - (b.st.costPerRequest ?? 0));
  const baselineTargetId = overall[0]?.id ?? null;

  const fingerprint = hash(
    JSON.stringify({
      picks: jobs.map((j) => [j.taskType, j.pick?.targetId ?? null]),
      baselineTargetId,
      bar: policy.qualityBar,
      slo: policy.sloMs,
      margin: policy.margin,
    })
  );

  const base: Omit<Decision, 'verdict' | 'reasons'> = {
    policy,
    fingerprint,
    baselineTargetId,
    jobs,
    holdout: [],
    qualityDelta: null,
    checksDelta: null,
    routedMonthly: null,
    baselineMonthly: null,
    savingsPct: null,
    devTasks: new Set(dev.map((r) => r.taskId)).size,
    holdoutTasks: new Set(hold.map((r) => r.taskId)).size,
  };

  const routed = jobs.filter((j) => j.pick);
  if (!baselineTargetId || !routed.length) {
    return { ...base, verdict: 'not-enough-data', reasons: [!baselineTargetId ? 'No priced, non-local model to compare against.' : 'No job has a model that clears the constraints on dev.'] };
  }
  if (!hold.length) {
    return { ...base, verdict: 'not-enough-data', reasons: ['This run has no holdout tasks. Run every task (--per-type 12) so the picks can be checked on tasks they were not chosen on.'] };
  }

  // ---------------------------------------------------------------- holdout
  const side = (id: string, t: TaskType): HoldoutSide => {
    const rows = hold.filter((r) => r.targetId === id && r.taskType === t);
    const st = stats(rows);
    return {
      targetId: id,
      n: new Set(rows.map((r) => r.taskId)).size,
      quality: mean([...perTask(rows, rowQuality).values()]),
      checksOnly: mean([...perTask(rows, rowChecks).values()]),
      p95: st.totalP95,
      costPerRequest: st.costPerRequest,
    };
  };

  const holdout: JobHoldout[] = routed.map((j) => {
    const pick = side(j.pick!.targetId, j.taskType);
    const why: string[] = [];
    if (!pick.n) why.push('no holdout answers');
    else {
      if ((pick.quality ?? 0) < policy.qualityBar) why.push(`quality fell to ${Math.round((pick.quality ?? 0) * 100)}`);
      if (pick.p95 == null || pick.p95 > policy.sloMs[j.taskType]) why.push(`p95 ${pick.p95 == null ? 'n/a' : (pick.p95 / 1000).toFixed(1) + 's'} over budget`);
    }
    return { taskType: j.taskType, pick, baseline: side(baselineTargetId, j.taskType), held: why.length === 0, why };
  });

  // Paired per-task differences, weighted by each job's share of traffic, resampled within each job.
  const pairs = (score: (r: ResultRow) => number) =>
    routed.map((j) => {
      const p = perTask(hold.filter((r) => r.targetId === j.pick!.targetId && r.taskType === j.taskType), score);
      const b = perTask(hold.filter((r) => r.targetId === baselineTargetId && r.taskType === j.taskType), score);
      return { w: policy.monthlyVolume[j.taskType], d: [...p.keys()].filter((k) => b.has(k)).map((k) => p.get(k)! - b.get(k)!) };
    }).filter((x) => x.d.length);

  const weightedDelta = (groups: { w: number; d: number[] }[]): Interval | null => {
    if (!groups.length) return null;
    const W = sum(groups.map((g) => g.w));
    const est = sum(groups.map((g) => g.w * mean(g.d)!)) / W;
    const draws: number[] = [];
    for (let b = 0; b < policy.resamples; b++) {
      let s = 0;
      for (const g of groups) {
        let m = 0;
        for (let i = 0; i < g.d.length; i++) m += g.d[Math.floor(rand() * g.d.length)]!;
        s += g.w * (m / g.d.length);
      }
      draws.push(s / W);
    }
    const tail = ((1 - policy.confidence) / 2) * 100;
    return { estimate: est, low: percentile(draws, tail)!, high: percentile(draws, 100 - tail)! };
  };

  const qualityDelta = weightedDelta(pairs(rowQuality));
  const checksDelta = weightedDelta(pairs(rowChecks));

  const costParts = holdout.map((h) => ({ v: policy.monthlyVolume[h.taskType], p: h.pick.costPerRequest, b: h.baseline.costPerRequest }));
  const priced = costParts.every((c) => c.p != null && c.b != null);
  const routedMonthly = priced ? sum(costParts.map((c) => c.v * c.p!)) : null;
  const baselineMonthly = priced ? sum(costParts.map((c) => c.v * c.b!)) : null;
  const savingsPct = routedMonthly != null && baselineMonthly ? 1 - routedMonthly / baselineMonthly : null;

  const reasons: string[] = [];
  let verdict: Verdict;
  const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
  if (routed.every((j) => j.pick!.targetId === baselineTargetId)) {
    verdict = 'no-change';
    reasons.push('The best single model is also the cheapest one that qualifies for every routed job, so routing changes nothing.');
  } else if (!qualityDelta || !checksDelta || routedMonthly == null || baselineMonthly == null) {
    verdict = 'not-enough-data';
    reasons.push('The pick and the baseline did not both answer the same holdout tasks, or a price is missing.');
  } else {
    const okQuality = qualityDelta.low >= -policy.margin;
    const okChecks = checksDelta.low >= -policy.margin;
    const cheaper = routedMonthly < baselineMonthly;
    verdict = okQuality && okChecks && cheaper ? 'pass' : 'fail';
    reasons.push(
      `${okQuality ? '✓' : '✗'} Quality vs baseline: ${pts(qualityDelta.estimate)} points (${Math.round(policy.confidence * 100)}% interval ${pts(qualityDelta.low)} to ${pts(qualityDelta.high)}); the floor is ${pts(-policy.margin)}.`,
      `${okChecks ? '✓' : '✗'} Deterministic checks only (no model grading): ${pts(checksDelta.estimate)} points (${pts(checksDelta.low)} to ${pts(checksDelta.high)}).`,
      `${cheaper ? '✓' : '✗'} Cost: $${routedMonthly.toFixed(2)}/mo routed vs $${baselineMonthly.toFixed(2)}/mo on the baseline.`
    );
    for (const h of holdout.filter((h) => !h.held)) reasons.push(`! ${TASK_TYPES[h.taskType].label}: the pick did not hold on holdout (${h.why.join(', ')}).`);
    const tentative = routed.filter((j) => j.pick!.confidence === 'tentative');
    if (tentative.length) reasons.push(`! Tentative on dev: ${tentative.map((j) => TASK_TYPES[j.taskType].label).join(', ')}. More dev tasks would firm these up.`);
  }

  return { ...base, holdout, qualityDelta, checksDelta, routedMonthly, baselineMonthly, savingsPct, verdict, reasons };
}
