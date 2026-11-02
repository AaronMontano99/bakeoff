/**
 * Shared shapes for the whole bake-off: targets (what we run against),
 * tasks (what we run), and results (what we measured).
 */

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'claude-cli';

/** How the capacity is bought. Drives the cost model and the business case. */
export type Deployment = 'serverless' | 'dedicated' | 'local' | 'subscription';

export interface Pricing {
  /** USD per 1M input tokens. null = not entered yet. */
  inputPerMTok: number | null;
  /** USD per 1M output tokens (thinking tokens bill as output). */
  outputPerMTok: number | null;
  /** USD per 1M cache-read input tokens, when the provider has prompt caching. */
  cacheReadPerMTok?: number | null;
  /** USD per 1M cache-write input tokens. */
  cacheWritePerMTok?: number | null;
  /** Where the number came from, so the report can cite it. */
  source?: string;
  /** YYYY-MM-DD the price was last checked. */
  verifiedOn?: string;
}

export interface DedicatedPricing {
  /** USD per GPU-hour for a dedicated deployment, for the serverless-vs-dedicated crossover. */
  hourlyUsd: number | null;
  /** Free-text GPU description, e.g. "1x H100". */
  gpu?: string;
}

export interface Target {
  id: string;
  label: string;
  provider: ProviderKind;
  /** Display name of the company/runtime, e.g. "Fireworks", "Ollama". */
  vendor: string;
  model: string;
  deployment: Deployment;
  /** openai-compatible only. */
  baseUrl?: string;
  /** Env var holding the key. Omit for keyless (local, CLI). */
  apiKeyEnv?: string;
  /** openai-compatible: ask for JSON mode (`response_format: json_object`). */
  jsonMode?: boolean;
  /** anthropic: effort level. Thinking tokens count as output and delay the first visible token. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** anthropic: put the shared playbook behind a cache breakpoint. */
  promptCaching?: boolean;
  maxTokens?: number;
  pricing: Pricing;
  dedicated?: DedicatedPricing;
  /** Disabled targets stay in config but are hidden from the run builder. */
  enabled: boolean;
  notes?: string;
}

export type TargetStatus =
  | { state: 'ready'; detail?: string }
  | { state: 'missing-key'; detail: string }
  | { state: 'offline'; detail: string }
  | { state: 'disabled'; detail: string };

/** A job, defined by a project in workloads/. Ids are unique across projects. */
export type TaskType = string;

/** A project's folder name in workloads/. */
export type WorkloadId = string;

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  /** dev = where picks are made; holdout = only used to check a pick already made. */
  split?: 'dev' | 'holdout';
  /** Task-specific input, read only by the project's own plugin. */
  input?: Record<string, unknown>;
  /** Ground truth for tasks that have one right answer. */
  gold?: Record<string, unknown>;
  /** Anything else in tasks.json. */
  [key: string]: unknown;
}

export interface TaskTypeInfo {
  type: TaskType;
  workload: WorkloadId;
  label: string;
  /** One word, for tight spots like chart columns and filter chips. */
  short: string;
  blurb: string;
  /** Named when this job misses its latency budget: "signal checks, the job a rep runs on every account". */
  budgetNote?: string;
  /** Shown before a run on a local model if this job is slow there. */
  localWarning?: string;
  /** Only warn from this many tasks per job. Default 1. */
  localWarningFromTasks?: number;
  /** What the shape of the traffic looks like, for the workload page. */
  profile: string;
  /** Default p95 latency budget the business case holds this task to. */
  defaultSloMs: number;
  /**
   * Which latency the budget is held to. 'total' = until the answer is done.
   * 'ttft' = until the first word shows, for answers the user watches stream in.
   */
  sloMetric?: 'total' | 'ttft';
  /** 'text' jobs answer in prose, so JSON mode stays off for them. Default 'json'. */
  output?: 'json' | 'text';
  /** Default share of monthly volume (per rep, or per user, per working day). */
  defaultPerRepPerDay: number;
  maxTokens: number;
}

export interface Prompt {
  system: string;
  /** Large stable prefix that every task shares (cache candidate). */
  playbook: string;
  user: string;
  /** false for prose answers: providers skip JSON mode. Default true. */
  json?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CallResult {
  text: string;
  usage: Usage;
  /** Wall-clock ms from request start to first visible text token. */
  ttftMs: number | null;
  totalMs: number;
  /** Provider-reported cost (Claude CLI reports an API-equivalent figure). */
  reportedCostUsd?: number;
  /** Anything a provider wants surfaced next to the number, e.g. CLI startup overhead. */
  caveat?: string;
}

export interface CheckResult {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface Judgement {
  score: number; // 1-5
  rationale: string;
}

/** warmup = one untimed-for-stats request per target, kept to report cold start. */
export type Phase = 'warmup' | 'quality' | 'load';

export interface ResultRow {
  id: number;
  runId: string;
  targetId: string;
  taskId: string;
  taskType: TaskType;
  phase: Phase;
  concurrency: number;
  repeat: number;
  startedAt: number;
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  tokensPerSec: number | null;
  costUsd: number | null;
  ok: boolean;
  error: string | null;
  output: string | null;
  checks: CheckResult[];
  checkScore: number | null;
  judgeScore: number | null;
  judgeRationale: string | null;
  humanScore: number | null;
}

export interface RunConfig {
  name: string;
  /** Which project the run draws tasks from. Runs from before projects were pluggable use the default. */
  workload?: WorkloadId;
  targetIds: string[];
  taskTypes: TaskType[];
  /** Cap tasks per type, so a run on a laptop stays short. */
  tasksPerType: number;
  repeats: number;
  /** Concurrency levels for the load phase. Empty = skip the load phase. */
  concurrency: number[];
  /** Requests fired per concurrency level per target. */
  loadRequests: number;
  /** Run targets side by side in the quality phase. Off = one at a time, cleanest local timing. */
  parallelTargets: boolean;
  judge: { enabled: boolean; targetId: string };
}

export type RunStatus = 'queued' | 'running' | 'judging' | 'done' | 'failed' | 'cancelled';

export interface RunRow {
  id: string;
  name: string;
  status: RunStatus;
  config: RunConfig;
  createdAt: number;
  finishedAt: number | null;
  error: string | null;
  totalPlanned: number;
  completed: number;
}

/** Live events the runner emits; the UI's race view is built from these. */
export type RunEvent =
  | { kind: 'status'; runId: string; status: RunStatus; detail?: string }
  | { kind: 'start'; runId: string; key: string; targetId: string; taskId: string; phase: Phase; concurrency: number }
  | { kind: 'token'; runId: string; key: string; targetId: string; text: string }
  /** Sent once on connect: what each lane is generating right now, so a late viewer sees the stream mid-flight. */
  | { kind: 'lane'; runId: string; key: string; targetId: string; taskId: string; phase: Phase; text: string; startedAt: number; firstTokenAt: number | null }
  | { kind: 'done'; runId: string; key: string; result: ResultRow }
  | { kind: 'judged'; runId: string; resultId: number; score: number; rationale: string }
  | { kind: 'progress'; runId: string; completed: number; total: number };
