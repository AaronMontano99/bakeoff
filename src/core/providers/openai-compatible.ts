import type { CallResult, Prompt, Target } from '../types';
import type { CallOptions } from './index';

/**
 * One adapter for every OpenAI-compatible chat endpoint: Ollama (local),
 * Fireworks, Together, Baseten Model APIs, Groq. Streams the response so
 * we can time the first token ourselves instead of trusting a header.
 */
export async function callOpenAICompatible(target: Target, prompt: Prompt, opts: CallOptions): Promise<CallResult> {
  if (!target.baseUrl) throw new Error(`${target.label}: no baseUrl configured`);
  const key = target.apiKeyEnv ? process.env[target.apiKeyEnv] : undefined;
  if (target.apiKeyEnv && !key) throw new Error(`${target.label}: ${target.apiKeyEnv} is not set`);

  const body: Record<string, unknown> = {
    model: target.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: opts.maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: `${prompt.playbook}\n\n${prompt.system}` },
      { role: 'user', content: prompt.user },
    ],
  };
  if (target.jsonMode) body.response_format = { type: 'json_object' };

  const started = performance.now();
  const res = await fetch(`${target.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
  }

  let text = '';
  let ttftMs: number | null = null;
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const evt = parseEvent(data);
      if (!evt) continue;
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) {
        if (ttftMs == null) ttftMs = performance.now() - started;
        text += delta;
        opts.onToken?.(delta);
      }
      if (evt.usage) {
        usage = {
          inputTokens: evt.usage.prompt_tokens ?? 0,
          outputTokens: evt.usage.completion_tokens ?? 0,
          cacheReadTokens: evt.usage.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        };
      }
    }
  }

  return { text, usage, ttftMs, totalMs: performance.now() - started };
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
}

export function parseEvent(data: string): ChatChunk | null {
  try {
    return JSON.parse(data) as ChatChunk;
  } catch {
    return null;
  }
}
