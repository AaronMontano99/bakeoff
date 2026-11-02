import type { TaskType, TaskTypeInfo, WorkloadId } from '../types';
import { REGISTERED_META } from './registry-meta.generated';
import type { WorkloadMeta } from './types';

export type { WorkloadMeta } from './types';

/** Client-safe workload metadata (no Node imports), shared by the UI and the analysis code. */

export const WORKLOADS: Record<WorkloadId, WorkloadMeta> = Object.fromEntries(REGISTERED_META.map((m) => [m.id, m]));

const first = REGISTERED_META.find((m) => m.isDefault) ?? REGISTERED_META[0];

/** The default opens first, the rest stay in folder order. */
export const WORKLOAD_ORDER: WorkloadId[] = [...REGISTERED_META].sort((a, b) => Number(b === first) - Number(a === first)).map((m) => m.id);
export const DEFAULT_WORKLOAD: WorkloadId = first?.id ?? '';

/** Every job in every workload. Job ids are unique across workloads, so one lookup serves all of them. */
export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = Object.fromEntries(REGISTERED_META.flatMap((m) => m.jobs.map((j) => [j.type, j])));

/** All jobs, workload by workload. Anything that filters to the jobs present in a run can iterate this. */
export const TASK_TYPE_ORDER: TaskType[] = WORKLOAD_ORDER.flatMap((w) => jobsOf(w));

/** A job's details. A run from a project that's no longer in workloads/ still renders, with its id as the label. */
export function jobInfo(t: TaskType): TaskTypeInfo {
  return (
    TASK_TYPES[t] ?? { type: t, workload: '', short: t, label: t, blurb: '', profile: '', defaultSloMs: 10_000, defaultPerRepPerDay: 1, maxTokens: 800 }
  );
}

export function workloadMeta(id: WorkloadId | undefined): WorkloadMeta {
  return (WORKLOADS[id ?? DEFAULT_WORKLOAD] ?? WORKLOADS[DEFAULT_WORKLOAD])!;
}

export function jobsOf(id: WorkloadId | undefined): TaskType[] {
  return workloadMeta(id).jobs.map((j) => j.type);
}

/** The p95 a job's latency budget is held to: first token for streamed answers, total time otherwise. */
export function sloP95(st: { ttftP95: number | null; totalP95: number | null }, t: TaskType): number | null {
  return jobInfo(t).sloMetric === 'ttft' ? st.ttftP95 : st.totalP95;
}

/** "p95" or "first-word p95", for the reason strings. */
export function sloName(t: TaskType): string {
  return jobInfo(t).sloMetric === 'ttft' ? 'first-word p95' : 'p95';
}
