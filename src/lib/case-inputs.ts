'use client';
import { defaultCaseInputs, type CaseInputs } from '@/core/analysis';
import type { WorkloadId } from '@/core/types';
import { DEFAULT_WORKLOAD } from '@/core/workload/meta';

/** Business-case assumptions are saved per workload: 10 reps on workdays and 1,000 app users every day don't mix. */
export function caseKey(workload: WorkloadId | undefined): string {
  const w = workload ?? DEFAULT_WORKLOAD;
  return w === DEFAULT_WORKLOAD ? 'bakeoff:case' : `bakeoff:case:${w}`;
}

export function loadCaseInputs(workload: WorkloadId | undefined): CaseInputs {
  const d = defaultCaseInputs(workload);
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(caseKey(workload)) : null;
    if (raw) {
      const saved = JSON.parse(raw) as Partial<CaseInputs>;
      return { ...d, ...saved, perRepPerDay: { ...d.perRepPerDay, ...saved.perRepPerDay }, sloMs: { ...d.sloMs, ...saved.sloMs } };
    }
  } catch {}
  return d;
}

export function saveCaseInputs(workload: WorkloadId | undefined, inputs: CaseInputs) {
  try {
    localStorage.setItem(caseKey(workload), JSON.stringify(inputs));
  } catch {}
}
