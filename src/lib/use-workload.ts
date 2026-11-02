'use client';
import type { Prompt, Task, WorkloadId } from '@/core/types';
import { DEFAULT_WORKLOAD, jobInfo, workloadMeta } from '@/core/workload/meta';
import { useJson } from './use-json';

export interface WorkloadData {
  id: WorkloadId;
  name: string;
  description: string;
  today: string;
  context?: Record<string, unknown>;
  tasks: (Task & { prompt: Prompt })[];
}

export function useWorkload(id: WorkloadId = DEFAULT_WORKLOAD) {
  const { data } = useJson<WorkloadData>(`/api/workload?id=${id}`);
  const byId = new Map((data?.tasks ?? []).map((t) => [t.id, t]));
  return { workload: data?.id === id ? data : undefined, task: (taskId: string) => byId.get(taskId) };
}

/** One line under a task's title, in the project's own words. */
export function taskSubtitle(t: Task): string {
  return workloadMeta(jobInfo(t.type).workload).taskSubtitle(t);
}
