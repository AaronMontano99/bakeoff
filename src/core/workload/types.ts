import type { CheckResult, Prompt, Task, TaskType, TaskTypeInfo, WorkloadId } from '../types';

/**
 * What a project gives Bakeoff. Two files in workloads/<id>/:
 *   meta.ts   client-safe facts about the project and its jobs
 *   index.ts  how to build prompts and grade answers
 * The engine and the screens only ever see these shapes, so nothing outside
 * workloads/ knows any project by name.
 */
export interface WorkloadMeta {
  id: WorkloadId;
  name: string;
  short: string;
  description: string;
  /** Who generates the traffic, for the business case: "rep", "user", "customer". */
  unit: string;
  /** Default number of them the business case assumes. */
  defaultUnits: number;
  /** Days a month they generate traffic. */
  defaultDays: number;
  /** One or two sentences on what's being tested, for the Method page and the brief. */
  about: string;
  /** Where the shared part of the prompt is explained on the Workload page. */
  sharedPrompt: { button: string; title: string; note: string };
  /** Opens by default. If no project sets it, the first alphabetically opens. */
  isDefault?: boolean;
  /** Show the raw expected answer on the Workload page. */
  showGold?: boolean;
  /** Short labels for what a task expects, shown as badges. */
  expected?(task: Task): string[];
  /** The project's jobs, in display order. */
  jobs: TaskTypeInfo[];
  /** One line under a task's title. */
  taskSubtitle(task: Task): string;
  /** A fuller version for a task's own page. Falls back to the subtitle. */
  taskDetail?(task: Task): string;
}

export interface Workload {
  id: WorkloadId;
  name: string;
  description: string;
  today: string;
  /** Whatever a project's prompts share across tasks. Only its own plugin reads this. */
  context?: Record<string, unknown>;
  tasks: Task[];
  [key: string]: unknown;
}

/** Terminal helpers handed to a project's own CLI commands. */
export interface CommandTools {
  table(rows: string[][]): void;
  sec(ms: number | null | undefined): string;
  green(text: string): string;
  dim(text: string): string;
}

export interface WorkloadPlugin {
  buildPrompt(task: Task, workload: Workload): Prompt;
  runChecks(task: Task, output: string, workload: Workload): { checks: CheckResult[]; score: number; parsed: unknown };
  rubrics: Partial<Record<TaskType, string>>;
  /** System prompt for the judge, which sees the candidate's prompt and answer. */
  judgeSystem: string;
  /** Extra commands this project adds to `npm run bakeoff`. */
  commands?: Record<string, { help: string; run(argv: string[], tools: CommandTools): Promise<void> | void }>;
}
