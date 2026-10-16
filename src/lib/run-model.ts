'use client';
import { useMemo } from 'react';
import { businessCase, calibration, loadCurve, paretoFrontier, summarize, type CaseInputs } from '@/core/analysis';
import type { ResultRow, RunRow } from '@/core/types';
import { seriesColor } from './palette';
import type { TargetWithStatus } from './types-client';

/** Everything the run views derive from raw rows, memoized in one place. */
export function useRunModel(run: RunRow | undefined, results: ResultRow[], targets: TargetWithStatus[] | null, inputs: CaseInputs) {
  return useMemo(() => {
    if (!run || !targets) return null;
    const ids = run.config.targetIds;
    const meta = (id: string) => {
      const index = targets.findIndex((t) => t.id === id);
      const t = targets[index];
      return { id, label: t?.label ?? id, color: seriesColor(index), target: t };
    };
    const summaries = summarize(results, ids);
    const frontierIds = paretoFrontier(
      summaries.filter((s) => s.costPerRequest != null && s.quality != null).map((s) => ({ id: s.targetId, cost: s.costPerRequest!, quality: s.quality! }))
    );
    const load = loadCurve(results);
    const bc = businessCase(summaries, targets, inputs);
    const cal = calibration(results.filter((r) => r.phase === 'quality'));
    return { ids, meta, summaries, frontierIds, load, bc, cal };
  }, [run, results, targets, inputs]);
}

export type RunModel = NonNullable<ReturnType<typeof useRunModel>>;
