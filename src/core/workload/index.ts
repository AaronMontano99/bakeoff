import fs from 'node:fs';
import path from 'node:path';
import type { Prompt, RunConfig, Task, TaskType, WorkloadId } from '../types';
import { DEFAULT_WORKLOAD, jobInfo, jobsOf } from './meta';
import { REGISTERED_PLUGINS } from './registry.generated';
import type { Workload, WorkloadPlugin } from './types';

export { TASK_TYPES, TASK_TYPE_ORDER, WORKLOADS, WORKLOAD_ORDER, DEFAULT_WORKLOAD, jobInfo, jobsOf, workloadMeta } from './meta';
export type { CommandTools, Workload, WorkloadMeta, WorkloadPlugin } from './types';

const cached = new Map<WorkloadId, Workload>();

export function loadWorkload(id: WorkloadId = DEFAULT_WORKLOAD, root = process.cwd()): Workload {
  const hit = cached.get(id);
  if (hit) return hit;
  const file = path.join(root, 'workloads', id, 'tasks.json');
  const w = { ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Omit<Workload, 'id'>), id } as Workload;
  cached.set(id, w);
  return w;
}

export function workloadPlugin(id: WorkloadId): WorkloadPlugin {
  const plugin = REGISTERED_PLUGINS[id];
  if (!plugin) throw new Error(`No workload "${id}" in workloads/`);
  return plugin;
}

export const workloadDef = workloadPlugin;

/** Every project-specific command, for the CLI. */
export function workloadCommands(): Record<string, NonNullable<WorkloadPlugin['commands']>[string]> {
  return Object.assign({}, ...Object.values(REGISTERED_PLUGINS).map((p) => p.commands ?? {}));
}

/** The workload a task belongs to, from its job. */
export function workloadOfTask(task: Task): WorkloadId {
  return jobInfo(task.type).workload || DEFAULT_WORKLOAD;
}

export function workloadForRun(config: Pick<RunConfig, 'workload'>): Workload {
  return loadWorkload(config.workload ?? DEFAULT_WORKLOAD);
}

export function tasksFor(workload: Workload, types: TaskType[], perType: number): Task[] {
  return jobsOf(workload.id)
    .filter((t) => types.includes(t))
    .flatMap((t) => workload.tasks.filter((task) => task.type === t).slice(0, perType));
}

export function buildPrompt(task: Task, workload: Workload): Prompt {
  const prompt = workloadPlugin(workload.id).buildPrompt(task, workload);
  // A job that answers in prose can't run in JSON mode, or the model has nothing to say but {}.
  return jobInfo(task.type).output === 'text' ? { ...prompt, json: false } : prompt;
}

export { extractJson } from '../json';
