import type { TaskType } from '@/core/types';
import { jobInfo, TASK_TYPES } from '@/core/workload/meta';

/** Marks a p95 that is time to first word, not time to done: the budget for answers that stream in. */
export function FirstWord({ t }: { t: TaskType }) {
  if (jobInfo(t).sloMetric !== 'ttft') return null;
  return (
    <span className="ml-1 text-[12px] text-ink-4" title="Held to time to first word: the reply streams in, so the wait the user feels is the first word.">
      first word
    </span>
  );
}
