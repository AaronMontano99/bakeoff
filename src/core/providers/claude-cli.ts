import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CallResult, Prompt, Target } from '../types';
import type { CallOptions } from './index';

/**
 * Claude through the Claude Code CLI (`claude -p`), on whatever claude.ai
 * login this machine has. No API key, no per-call bill. Same isolation as
 * Scout: no user settings, no MCP, no tools, no saved session, an empty
 * working directory, and ANTHROPIC_API_KEY stripped so it can't silently
 * switch to API billing.
 *
 * Timing includes CLI process startup, so it is NOT comparable to API
 * latency. The UI labels it that way. The CLI reports an API-equivalent
 * cost, which we keep so the business case can show what the same traffic
 * would cost on the API.
 */
const WORKDIR = path.join(process.cwd(), 'data', 'claude-workdir');

export function claudeBin(): string {
  if (process.env.BAKEOFF_CLAUDE_BIN) return process.env.BAKEOFF_CLAUDE_BIN;
  const local = path.join(os.homedir(), '.local', 'bin', 'claude');
  return fs.existsSync(local) ? local : 'claude';
}

export function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export async function callClaudeCli(target: Target, prompt: Prompt, opts: CallOptions): Promise<CallResult> {
  fs.mkdirSync(WORKDIR, { recursive: true });
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', target.model,
    '--system-prompt', `${prompt.playbook}\n\n${prompt.system}`,
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ];

  const started = performance.now();
  let ttftMs: number | null = null;
  let text = '';
  type Final = { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: Record<string, number> };
  const state: { final: Final | null } = { final: null };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd: WORKDIR, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    const onAbort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt: Record<string, any>;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === 'stream_event' && evt.event?.type === 'content_block_delta' && evt.event.delta?.type === 'text_delta') {
          const delta: string = evt.event.delta.text;
          if (ttftMs == null) ttftMs = performance.now() - started;
          text += delta;
          opts.onToken?.(delta);
        } else if (evt.type === 'result') {
          state.final = evt as Final;
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(e.code === 'ENOENT' ? new Error('Claude Code CLI not found. Install it from claude.com/claude-code.') : e)
    );
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new Error('Cancelled'));
      if (code !== 0 && !state.final) {
        const msg = `${stderr}`.trim();
        if (/not logged in|\/login|authentication/i.test(msg)) return reject(new Error('Claude Code is not logged in. Run `claude` once and log in.'));
        if (/usage limit|rate limit|limit reached/i.test(msg)) return reject(new Error('Claude usage limit reached. It resets on its own.'));
        return reject(new Error(`claude exited ${code}${msg ? `: ${msg.slice(0, 240)}` : ''}`));
      }
      resolve();
    });
    child.stdin.end(prompt.user);
  });

  const result = state.final;
  if (!result) throw new Error('Claude CLI ended without a result');
  if (result.is_error) throw new Error(`Claude CLI error: ${(result.result ?? '').slice(0, 240)}`);
  if (!text) text = result.result ?? '';
  const u = result.usage ?? {};

  return {
    text,
    ttftMs,
    totalMs: performance.now() - started,
    reportedCostUsd: result.total_cost_usd,
    caveat: 'Includes Claude Code CLI startup; not comparable to raw API latency.',
    usage: {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/** Live login check, not a static claim. */
export function claudeCliStatus(): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(claudeBin(), ['auth', 'status'], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 8_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, detail: 'Claude Code CLI not installed' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const s = JSON.parse(out) as { loggedIn?: boolean };
        resolve(s.loggedIn ? { ok: true, detail: 'Logged in via claude.ai' } : { ok: false, detail: 'Run `claude` once and log in' });
      } catch {
        resolve({ ok: false, detail: "Couldn't read Claude Code login status" });
      }
    });
  });
}
