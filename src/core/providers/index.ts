import type { CallResult, Prompt, Target, TargetStatus, Usage } from '../types';
import { callAnthropic } from './anthropic';
import { callClaudeCli, claudeCliStatus } from './claude-cli';
import { callOpenAICompatible } from './openai-compatible';

export interface CallOptions {
  maxTokens: number;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export function callTarget(target: Target, prompt: Prompt, opts: CallOptions): Promise<CallResult> {
  switch (target.provider) {
    case 'openai-compatible':
      return callOpenAICompatible(target, prompt, opts);
    case 'anthropic':
      return callAnthropic(target, prompt, opts);
    case 'claude-cli':
      return callClaudeCli(target, prompt, opts);
  }
}

/**
 * What a request cost. Subscription (CLI) runs report an API-equivalent
 * figure from the CLI itself; local runs are $0 marginal. Returns null
 * when the price hasn't been entered, so the UI can ask for it instead of
 * showing a made-up number.
 */
export function costOf(target: Target, usage: Usage, reported?: number): number | null {
  if (target.deployment === 'local') return 0;
  if (target.deployment === 'subscription') return reported ?? null;
  const p = target.pricing;
  if (p.inputPerMTok == null || p.outputPerMTok == null) return null;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const readPrice = p.cacheReadPerMTok ?? p.inputPerMTok;
  const writePrice = p.cacheWritePerMTok ?? p.inputPerMTok;
  return (
    (uncachedInput * p.inputPerMTok + usage.cacheReadTokens * readPrice + usage.cacheWriteTokens * writePrice + usage.outputTokens * p.outputPerMTok) /
    1_000_000
  );
}

export async function checkTarget(target: Target): Promise<TargetStatus> {
  if (!target.enabled) return { state: 'disabled', detail: 'Turned off in config/targets.json' };
  if (target.provider === 'claude-cli') {
    const s = await claudeCliStatus();
    return s.ok ? { state: 'ready', detail: s.detail } : { state: 'offline', detail: s.detail };
  }
  if (target.apiKeyEnv && !process.env[target.apiKeyEnv]) {
    return { state: 'missing-key', detail: `Add ${target.apiKeyEnv} to .env.local` };
  }
  if (target.deployment === 'local' && target.baseUrl) {
    try {
      const root = target.baseUrl.replace(/\/v1\/?$/, '');
      const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (!res.ok) return { state: 'offline', detail: `Ollama answered ${res.status}` };
      const tags = (await res.json()) as { models?: { name: string }[] };
      const names = (tags.models ?? []).map((m) => m.name);
      const has = names.some((n) => n === target.model || n === `${target.model}:latest` || n.split(':')[0] === target.model);
      return has ? { state: 'ready', detail: 'Running locally' } : { state: 'offline', detail: `Run: ollama pull ${target.model}` };
    } catch {
      return { state: 'offline', detail: 'Ollama is not running. Start it with: ollama serve' };
    }
  }
  return { state: 'ready', detail: 'Key found' };
}
