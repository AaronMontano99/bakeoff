import type { ResultRow, RunRow, Target, TargetStatus } from '@/core/types';

export type TargetWithStatus = Target & { status: TargetStatus; history: { medianMs: number | null; medianCost: number | null } };
export type RunListItem = RunRow & { headline: string | null; best: { targetId: string; quality: number | null } | null };
export interface RunDetail {
  run: RunRow;
  results: ResultRow[];
}
