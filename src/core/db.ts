import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CheckResult, Phase, ResultRow, RunConfig, RunRow, RunStatus, TaskType } from './types';

/**
 * One SQLite file holds every run. The web app and the CLI share it, so a
 * run started from the terminal shows up live in the dashboard.
 */
const g = globalThis as unknown as { __bakeoffDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__bakeoffDb) return g.__bakeoffDb;
  const file = process.env.BAKEOFF_DB ?? path.join(process.cwd(), 'data', 'bakeoff.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      total_planned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      phase TEXT NOT NULL,
      concurrency INTEGER NOT NULL,
      repeat INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ttft_ms REAL,
      total_ms REAL NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      tokens_per_sec REAL,
      cost_usd REAL,
      ok INTEGER NOT NULL,
      error TEXT,
      output TEXT,
      checks_json TEXT NOT NULL DEFAULT '[]',
      check_score REAL,
      judge_score REAL,
      judge_rationale TEXT
    );
    CREATE INDEX IF NOT EXISTS results_run ON results(run_id);
    CREATE TABLE IF NOT EXISTS human_grades (
      result_id INTEGER PRIMARY KEY REFERENCES results(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  g.__bakeoffDb = conn;
  return conn;
}

type Row = Record<string, unknown>;

function toRun(r: Row, completed: number): RunRow {
  return {
    id: r.id as string,
    name: r.name as string,
    status: r.status as RunStatus,
    config: JSON.parse(r.config_json as string) as RunConfig,
    createdAt: r.created_at as number,
    finishedAt: (r.finished_at as number | null) ?? null,
    error: (r.error as string | null) ?? null,
    totalPlanned: r.total_planned as number,
    completed,
  };
}

function toResult(r: Row): ResultRow {
  return {
    id: r.id as number,
    runId: r.run_id as string,
    targetId: r.target_id as string,
    taskId: r.task_id as string,
    taskType: r.task_type as TaskType,
    phase: r.phase as Phase,
    concurrency: r.concurrency as number,
    repeat: r.repeat as number,
    startedAt: r.started_at as number,
    ttftMs: (r.ttft_ms as number | null) ?? null,
    totalMs: r.total_ms as number,
    inputTokens: r.input_tokens as number,
    outputTokens: r.output_tokens as number,
    cacheReadTokens: r.cache_read_tokens as number,
    tokensPerSec: (r.tokens_per_sec as number | null) ?? null,
    costUsd: (r.cost_usd as number | null) ?? null,
    ok: r.ok === 1,
    error: (r.error as string | null) ?? null,
    output: (r.output as string | null) ?? null,
    checks: JSON.parse((r.checks_json as string) || '[]') as CheckResult[],
    checkScore: (r.check_score as number | null) ?? null,
    judgeScore: (r.judge_score as number | null) ?? null,
    judgeRationale: (r.judge_rationale as string | null) ?? null,
    humanScore: (r.human_score as number | null) ?? null,
  };
}

export function createRun(id: string, config: RunConfig, totalPlanned: number): void {
  db()
    .prepare('INSERT INTO runs (id, name, status, config_json, created_at, total_planned) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, config.name, 'queued', JSON.stringify(config), Date.now(), totalPlanned);
}

export function setRunStatus(id: string, status: RunStatus, error?: string): void {
  const finished = ['done', 'failed', 'cancelled'].includes(status) ? Date.now() : null;
  db().prepare('UPDATE runs SET status = ?, error = COALESCE(?, error), finished_at = COALESCE(?, finished_at) WHERE id = ?').run(status, error ?? null, finished, id);
}

export function listRuns(): RunRow[] {
  const rows = db()
    .prepare('SELECT r.*, (SELECT COUNT(*) FROM results x WHERE x.run_id = r.id) AS completed FROM runs r ORDER BY created_at DESC')
    .all() as Row[];
  return rows.map((r) => toRun(r, r.completed as number));
}

export function getRun(id: string): RunRow | null {
  const r = db().prepare('SELECT r.*, (SELECT COUNT(*) FROM results x WHERE x.run_id = r.id) AS completed FROM runs r WHERE id = ?').get(id) as Row | undefined;
  return r ? toRun(r, r.completed as number) : null;
}

export function deleteRun(id: string): void {
  db().prepare('DELETE FROM human_grades WHERE result_id IN (SELECT id FROM results WHERE run_id = ?)').run(id);
  db().prepare('DELETE FROM results WHERE run_id = ?').run(id);
  db().prepare('DELETE FROM runs WHERE id = ?').run(id);
}

export function insertResult(r: Omit<ResultRow, 'id' | 'humanScore' | 'judgeScore' | 'judgeRationale'>): ResultRow {
  const info = db()
    .prepare(
      `INSERT INTO results (run_id, target_id, task_id, task_type, phase, concurrency, repeat, started_at, ttft_ms, total_ms,
        input_tokens, output_tokens, cache_read_tokens, tokens_per_sec, cost_usd, ok, error, output, checks_json, check_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      r.runId, r.targetId, r.taskId, r.taskType, r.phase, r.concurrency, r.repeat, r.startedAt, r.ttftMs, r.totalMs,
      r.inputTokens, r.outputTokens, r.cacheReadTokens, r.tokensPerSec, r.costUsd, r.ok ? 1 : 0, r.error, r.output,
      JSON.stringify(r.checks), r.checkScore
    );
  return { ...r, id: Number(info.lastInsertRowid), judgeScore: null, judgeRationale: null, humanScore: null };
}

export function setJudgement(resultId: number, score: number | null, rationale: string): void {
  db().prepare('UPDATE results SET judge_score = ?, judge_rationale = ? WHERE id = ?').run(score, rationale, resultId);
}

export function listResults(runId: string, since = 0): ResultRow[] {
  const rows = db()
    .prepare(
      'SELECT x.*, h.score AS human_score FROM results x LEFT JOIN human_grades h ON h.result_id = x.id WHERE x.run_id = ? AND x.id > ? ORDER BY x.id'
    )
    .all(runId, since) as Row[];
  return rows.map(toResult);
}

export function setHumanGrade(resultId: number, score: number | null): void {
  if (score == null) db().prepare('DELETE FROM human_grades WHERE result_id = ?').run(resultId);
  else db().prepare('INSERT INTO human_grades (result_id, score, created_at) VALUES (?, ?, ?) ON CONFLICT(result_id) DO UPDATE SET score = excluded.score').run(resultId, score, Date.now());
}
