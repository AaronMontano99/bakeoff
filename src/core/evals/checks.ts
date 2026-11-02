import type { CheckResult, Task } from '../types';
import { loadWorkload, workloadDef, workloadOfTask } from '../workload';

export { words } from './text';

/**
 * Deterministic checks: things a script can grade without an opinion.
 * Each project owns its own in workloads/; this routes a task to the right
 * set by its job.
 */
export function runChecks(task: Task, output: string): { checks: CheckResult[]; score: number; parsed: unknown } {
  const id = workloadOfTask(task);
  return workloadDef(id).runChecks(task, output, loadWorkload(id));
}
