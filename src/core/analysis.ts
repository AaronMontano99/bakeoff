import { mean, percentile, spearman, sum } from './stats';
import type { ResultRow, Target, TaskType } from './types';
import { TASK_TYPE_ORDER, TASK_TYPES } from './workload/meta';

/**
 * Turns raw result rows into the numbers the dashboard and the business
 * case show. Pure functions over arrays, so they're easy to test and the
 * same math runs in the CLI report and the web UI.
 */

export interface Stats {
  n: number;
  okRate: number;
  ttftP50: number | null;
  ttftP95: number | null;
  totalP50: number | null;
  totalP95: number | null;
  tokensPerSec: number | null;
  /** Mean USD per successful request; null if any price is missing. */
  costPerRequest: number | null;
  checkScore: number | null;
  /** 1-5 */
  judgeScore: number | null;
  /** 0-1 composite: half checks, half judge (rescaled), or checks alone with no judge. */
  quality: number | null;
  /** Share of ground-truth checks passed (signal label, debrief outcome, meeting flags). */
  accuracy: number | null;
  cacheHitRate: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
}

const GOLD_CHECKS = new Set(['signal-label', 'outcome-correct', 'meeting-flags']);

export function quality(check: number | null, judge: number | null): number | null {
  if (check == null && judge == null) return null;
  if (judge == null) return check;
  const j = (judge - 1) / 4;
  return check == null ? j : 0.5 * check + 0.5 * j;
}

export function stats(rows: ResultRow[]): Stats {
  const ok = rows.filter((r) => r.ok);
  const costs = ok.map((r) => r.costUsd);
  const gold = ok.flatMap((r) => r.checks.filter((c) => GOLD_CHECKS.has(c.id)));
  const judged = ok.map((r) => r.judgeScore).filter((v): v is number => v != null);
  const inTok = sum(ok.map((r) => r.inputTokens));
  const check = mean(ok.map((r) => r.checkScore ?? 0));
  // Failed requests count as zero quality: a model that errors half the time isn't "high quality".
  const okRate = rows.length ? ok.length / rows.length : 0;
  const judgeMean = judged.length ? mean(judged) : null;
  const q = quality(check, judgeMean);
  return {
    n: rows.length,
    okRate,
    ttftP50: percentile(ok.map((r) => r.ttftMs ?? NaN), 50),
    ttftP95: percentile(ok.map((r) => r.ttftMs ?? NaN), 95),
    totalP50: percentile(ok.map((r) => r.totalMs), 50),
    totalP95: percentile(ok.map((r) => r.totalMs), 95),
    tokensPerSec: percentile(ok.map((r) => r.tokensPerSec ?? NaN), 50),
    costPerRequest: ok.length && costs.every((c) => c != null) ? mean(costs as number[]) : null,
    checkScore: check,
    judgeScore: judgeMean,
    quality: q == null ? null : q * okRate,
    accuracy: gold.length ? gold.filter((c) => c.pass).length / gold.length : null,
    cacheHitRate: inTok > 0 ? sum(ok.map((r) => r.cacheReadTokens)) / inTok : null,
    avgInputTokens: mean(ok.map((r) => r.inputTokens)),
    avgOutputTokens: mean(ok.map((r) => r.outputTokens)),
  };
}

export interface TargetSummary extends Stats {
  targetId: string;
  /** Total time of the warm-up request: model load, connection setup, CLI start. */
  coldStartMs: number | null;
  byType: Partial<Record<TaskType, Stats>>;
}

export function summarize(results: ResultRow[], targetIds: string[]): TargetSummary[] {
  const qualityRows = results.filter((r) => r.phase === 'quality');
  return targetIds.map((id) => {
    const mine = qualityRows.filter((r) => r.targetId === id);
    const byType: Partial<Record<TaskType, Stats>> = {};
    for (const t of TASK_TYPE_ORDER) {
      const rows = mine.filter((r) => r.taskType === t);
      if (rows.length) byType[t] = stats(rows);
    }
    const warm = results.find((r) => r.phase === 'warmup' && r.targetId === id && r.ok);
    return { targetId: id, coldStartMs: warm?.totalMs ?? null, ...stats(mine), byType };
  });
}

export interface LoadPoint {
  targetId: string;
  concurrency: number;
  n: number;
  errorRate: number;
  totalP50: number | null;
  totalP95: number | null;
  ttftP95: number | null;
  /** Completed requests per second across the whole level. */
  requestsPerSec: number | null;
  /** Output tokens per second across the whole level. */
  outputTokensPerSec: number | null;
}

export function loadCurve(results: ResultRow[]): LoadPoint[] {
  const load = results.filter((r) => r.phase === 'load');
  const keys = [...new Set(load.map((r) => `${r.targetId}|${r.concurrency}`))];
  return keys
    .map((key) => {
      const [targetId, c] = key.split('|') as [string, string];
      const rows = load.filter((r) => r.targetId === targetId && r.concurrency === Number(c));
      const ok = rows.filter((r) => r.ok);
      const start = Math.min(...rows.map((r) => r.startedAt));
      const end = Math.max(...rows.map((r) => r.startedAt + r.totalMs));
      const wallS = (end - start) / 1000;
      return {
        targetId,
        concurrency: Number(c),
        n: rows.length,
        errorRate: rows.length ? 1 - ok.length / rows.length : 0,
        totalP50: percentile(ok.map((r) => r.totalMs), 50),
        totalP95: percentile(ok.map((r) => r.totalMs), 95),
        ttftP95: percentile(ok.map((r) => r.ttftMs ?? NaN), 95),
        requestsPerSec: wallS > 0 ? ok.length / wallS : null,
        outputTokensPerSec: wallS > 0 ? sum(ok.map((r) => r.outputTokens)) / wallS : null,
      };
    })
    .sort((a, b) => a.targetId.localeCompare(b.targetId) || a.concurrency - b.concurrency);
}

/** Targets no other target beats on both cost and quality. */
export function paretoFrontier(points: { id: string; cost: number; quality: number }[]): Set<string> {
  const out = new Set<string>();
  for (const p of points) {
    const dominated = points.some((q) => q.id !== p.id && q.cost <= p.cost && q.quality >= p.quality && (q.cost < p.cost || q.quality > p.quality));
    if (!dominated) out.add(p.id);
  }
  return out;
}

// ---------------------------------------------------------------- business case

export interface CaseInputs {
  reps: number;
  workdays: number;
  perRepPerDay: Record<TaskType, number>;
  sloMs: Record<TaskType, number>;
  /** Minimum composite quality (0-1) a target must reach to be routed a task. */
  qualityBar: number;
}

export function defaultCaseInputs(): CaseInputs {
  const perRepPerDay = {} as Record<TaskType, number>;
  const sloMs = {} as Record<TaskType, number>;
  for (const t of TASK_TYPE_ORDER) {
    perRepPerDay[t] = TASK_TYPES[t].defaultPerRepPerDay;
    sloMs[t] = TASK_TYPES[t].defaultSloMs;
  }
  return { reps: 10, workdays: 21, perRepPerDay, sloMs, qualityBar: 0.8 };
}

export interface RouteOption {
  targetId: string;
  quality: number | null;
  p95: number | null;
  costPerRequest: number | null;
  monthlyCost: number | null;
  eligible: boolean;
  why: string[];
}

export interface Route {
  taskType: TaskType;
  monthlyVolume: number;
  options: RouteOption[];
  pick: RouteOption | null;
  baseline: RouteOption | null;
}

export interface Gap {
  taskType: TaskType;
  message: string;
  /** The smallest change to the assumptions that would route this job, if one exists. */
  fix?: { label: string; sloMs?: number; qualityBar?: number };
}

export interface BusinessCase {
  inputs: CaseInputs;
  routes: Route[];
  /** Sum over the jobs that have a pick; `routedCount` says how many that is. */
  routedMonthly: number | null;
  routedCount: number;
  baselineMonthly: number | null;
  baselineTargetId: string | null;
  savingsPct: number | null;
  headline: string;
  lines: string[];
  gaps: Gap[];
}

const usd = (n: number) => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

export function businessCase(summaries: TargetSummary[], targets: Target[], inputs: CaseInputs): BusinessCase {
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
  const deployment = (id: string) => targets.find((t) => t.id === id)?.deployment;

  // Baseline: the best overall model with a known price, "just use the best one for everything".
  const priced = summaries.filter((s) => s.costPerRequest != null && s.quality != null && deployment(s.targetId) !== 'local');
  const baselineSummary = [...priced].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || (a.costPerRequest ?? 0) - (b.costPerRequest ?? 0))[0];
  const baselineTargetId = baselineSummary?.targetId ?? null;

  const routes: Route[] = [];
  const gaps: Gap[] = [];

  for (const t of TASK_TYPE_ORDER) {
    const present = summaries.filter((s) => s.byType[t]);
    if (!present.length) continue;
    const monthlyVolume = Math.round(inputs.reps * inputs.workdays * inputs.perRepPerDay[t]);
    const options: RouteOption[] = present.map((s) => {
      const st = s.byType[t]!;
      const why: string[] = [];
      if (st.quality == null || st.quality < inputs.qualityBar) why.push(`quality ${st.quality == null ? 'n/a' : Math.round(st.quality * 100)} under the ${Math.round(inputs.qualityBar * 100)} bar`);
      if (st.totalP95 == null || st.totalP95 > inputs.sloMs[t]) why.push(`p95 ${st.totalP95 == null ? 'n/a' : (st.totalP95 / 1000).toFixed(1) + 's'} over the ${(inputs.sloMs[t] / 1000).toFixed(0)}s budget`);
      if (st.okRate < 0.95) why.push(`${Math.round((1 - st.okRate) * 100)}% of requests failed`);
      if (st.costPerRequest == null) why.push('no price entered');
      return {
        targetId: s.targetId,
        quality: st.quality,
        p95: st.totalP95,
        costPerRequest: st.costPerRequest,
        monthlyCost: st.costPerRequest == null ? null : st.costPerRequest * monthlyVolume,
        eligible: why.length === 0,
        why,
      };
    });
    const eligible = options.filter((o) => o.eligible).sort((a, b) => (a.costPerRequest ?? 0) - (b.costPerRequest ?? 0) || (b.quality ?? 0) - (a.quality ?? 0));
    const pick = eligible[0] ?? null;
    const baseline = options.find((o) => o.targetId === baselineTargetId) ?? null;
    if (!pick) gaps.push(gapFor(t, options, inputs, label));
    routes.push({ taskType: t, monthlyVolume, options, pick, baseline });
  }

  const routed = routes.filter((r) => r.pick?.monthlyCost != null);
  const routedCount = routed.length;
  const routedMonthly = routedCount ? sum(routed.map((r) => r.pick!.monthlyCost!)) : null;
  // Compare like with like: the baseline over the same jobs that were routed.
  const baselineParts = routed.map((r) => r.baseline?.monthlyCost ?? null);
  const baselineMonthly = baselineParts.length && baselineParts.every((v) => v != null) ? sum(baselineParts as number[]) : null;
  const savingsPct = routedMonthly != null && baselineMonthly && baselineMonthly > 0 ? 1 - routedMonthly / baselineMonthly : null;
  const partial = routedCount < routes.length;

  const lines: string[] = [];
  for (const r of routes) {
    if (!r.pick) continue;
    const name = TASK_TYPES[r.taskType].label;
    const q = r.pick.quality != null ? Math.round(r.pick.quality * 100) : null;
    const bq = r.baseline?.quality != null ? Math.round(r.baseline.quality * 100) : null;
    const delta = q != null && bq != null && r.baseline?.targetId !== r.pick.targetId ? ` (${q - bq >= 0 ? '+' : ''}${q - bq} quality vs ${label(r.baseline!.targetId)})` : '';
    lines.push(`${name}: ${label(r.pick.targetId)}, ${usd(r.pick.costPerRequest ?? 0)} per request, ${r.monthlyVolume.toLocaleString('en-US')}/mo${delta}.`);
  }

  const scope = partial ? `the ${routedCount} of ${routes.length} jobs with a qualifying model` : 'each job';
  let headline = 'Run a benchmark with at least one priced target to build the business case.';
  if (routedMonthly != null && baselineMonthly != null && savingsPct != null && baselineTargetId) {
    headline =
      savingsPct > 0.01
        ? `Routing ${scope} to the cheapest model that clears the bar costs ${usd(routedMonthly)}/mo instead of ${usd(baselineMonthly)}/mo on ${label(baselineTargetId)}: ${Math.round(savingsPct * 100)}% less.`
        : `${label(baselineTargetId)} is the cheapest model that clears the bar for ${partial ? `${routedCount} of ${routes.length} jobs` : 'every job'}: ${usd(baselineMonthly)}/mo.`;
  } else if (routedMonthly != null) {
    headline = `Routing ${scope} to the cheapest model that clears the bar costs ${usd(routedMonthly)}/mo.`;
  } else if (routes.length && gaps.length) {
    headline = 'No job has a model that clears the bar, the latency budget and has a price yet. See what would change that below.';
  }
  if (partial && routedMonthly != null) headline += ` ${gaps.map((g) => TASK_TYPES[g.taskType].label).join(' and ')} still needs a model.`;

  return { inputs, routes, routedMonthly, routedCount, baselineMonthly, baselineTargetId, savingsPct, headline, lines, gaps };
}

/** Explain why nothing qualified, and find the smallest assumption change that would fix it. */
function gapFor(t: TaskType, options: RouteOption[], inputs: CaseInputs, label: (id: string) => string): Gap {
  const name = TASK_TYPES[t].label;
  const priced = options.filter((o) => o.costPerRequest != null && (o.quality ?? 0) > 0);
  // Only latency in the way: suggest the budget that would let the best-quality one in.
  const latencyOnly = priced
    .filter((o) => (o.quality ?? 0) >= inputs.qualityBar && o.p95 != null && o.p95 > inputs.sloMs[t])
    .sort((a, b) => a.p95! - b.p95!);
  if (latencyOnly[0]) {
    const o = latencyOnly[0];
    const secs = Math.ceil(o.p95! / 1000);
    return {
      taskType: t,
      message: `${name}: every model that’s good enough is too slow for a ${(inputs.sloMs[t] / 1000).toFixed(0)}s p95. Closest: ${label(o.targetId)} at ${(o.p95! / 1000).toFixed(1)}s. Raise the budget, or add a faster target.`,
      fix: { label: `Use a ${secs}s budget`, sloMs: secs * 1000 },
    };
  }
  const qualityOnly = priced
    .filter((o) => o.p95 != null && o.p95 <= inputs.sloMs[t] && (o.quality ?? 0) < inputs.qualityBar)
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
  if (qualityOnly[0]) {
    const o = qualityOnly[0];
    const bar = Math.floor((o.quality ?? 0) * 100) / 100;
    return {
      taskType: t,
      message: `${name}: the fast enough models score under the bar. Best: ${label(o.targetId)} at ${Math.round((o.quality ?? 0) * 100)}.`,
      fix: bar >= 0.5 ? { label: `Accept ${Math.round(bar * 100)} quality`, qualityBar: bar } : undefined,
    };
  }
  if (!priced.length) return { taskType: t, message: `${name}: no target here has a price yet. Add one on the Targets page.` };
  return { taskType: t, message: `${name}: nothing cleared the quality bar and the latency budget together.` };
}

// ---------------------------------------------------------------- serverless vs dedicated

export interface Crossover {
  targetId: string;
  hourlyUsd: number;
  costPerRequest: number;
  /** Sustained requests/sec one replica handled in the load test. */
  replicaRps: number;
  /** Monthly requests where one dedicated replica becomes cheaper than per-token. */
  breakEvenMonthly: number;
  curve: { volume: number; serverless: number; dedicated: number }[];
}

const HOURS_PER_MONTH = 730;

export function crossover(target: Target, costPerRequest: number | null, load: LoadPoint[], currentMonthly: number, utilization = 0.6): Crossover | null {
  const hourly = target.dedicated?.hourlyUsd;
  if (hourly == null || costPerRequest == null || costPerRequest <= 0) return null;
  const best = Math.max(0, ...load.filter((l) => l.targetId === target.id).map((l) => l.requestsPerSec ?? 0));
  if (best <= 0) return null;
  const capacityPerMonth = best * utilization * 3600 * HOURS_PER_MONTH;
  const replicaMonthly = hourly * HOURS_PER_MONTH;
  const breakEvenMonthly = replicaMonthly / costPerRequest;
  const maxVolume = Math.max(currentMonthly * 4, breakEvenMonthly * 2, capacityPerMonth * 1.5);
  const curve = Array.from({ length: 41 }, (_, i) => {
    const volume = (maxVolume * i) / 40;
    return { volume, serverless: volume * costPerRequest, dedicated: Math.max(1, Math.ceil(volume / capacityPerMonth)) * replicaMonthly };
  });
  return { targetId: target.id, hourlyUsd: hourly, costPerRequest, replicaRps: best, breakEvenMonthly, curve };
}

// ---------------------------------------------------------------- judge calibration

export interface Calibration {
  n: number;
  exact: number | null;
  withinOne: number | null;
  spearman: number | null;
  /** Mean of judge minus human; positive = judge grades generously. */
  bias: number | null;
}

export function calibration(results: ResultRow[]): Calibration {
  const pairs = results.filter((r) => r.judgeScore != null && r.humanScore != null).map((r) => [r.judgeScore!, r.humanScore!] as const);
  if (!pairs.length) return { n: 0, exact: null, withinOne: null, spearman: null, bias: null };
  return {
    n: pairs.length,
    exact: pairs.filter(([j, h]) => j === h).length / pairs.length,
    withinOne: pairs.filter(([j, h]) => Math.abs(j - h) <= 1).length / pairs.length,
    spearman: spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
    bias: mean(pairs.map(([j, h]) => j - h)),
  };
}
