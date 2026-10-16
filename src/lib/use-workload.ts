'use client';
import type { Prompt, Task } from '@/core/types';
import { useJson } from './use-json';

export interface WorkloadData {
  id: string;
  name: string;
  description: string;
  today: string;
  tasks: (Task & { prompt: Prompt })[];
}

export function useWorkload() {
  const { data } = useJson<WorkloadData>('/api/workload');
  const byId = new Map((data?.tasks ?? []).map((t) => [t.id, t]));
  return { workload: data, task: (id: string) => byId.get(id) };
}
