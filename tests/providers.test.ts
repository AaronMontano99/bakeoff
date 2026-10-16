import { afterEach, describe, expect, it, vi } from 'vitest';
import { callOpenAICompatible } from '@/core/providers/openai-compatible';
import type { Target } from '@/core/types';

const target: Target = {
  id: 'x',
  label: 'X',
  provider: 'openai-compatible',
  vendor: 'V',
  model: 'm',
  deployment: 'serverless',
  baseUrl: 'https://example.test/v1',
  pricing: { inputPerMTok: 1, outputPerMTok: 1 },
  enabled: true,
};

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.restoreAllMocks());

describe('openai-compatible streaming', () => {
  it('assembles text across split chunks, times the first token, and reads usage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"{\\"a\\""}}]}\n\nda',
        'ta: {"choices":[{"delta":{"content":": 1}"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":100}}}\n\n',
        'data: [DONE]\n\n',
      ])
    );
    const tokens: string[] = [];
    const res = await callOpenAICompatible(target, { playbook: 'p', system: 's', user: 'u' }, { maxTokens: 50, onToken: (t) => tokens.push(t) });
    expect(res.text).toBe('{"a": 1}');
    expect(tokens).toHaveLength(2);
    expect(res.ttftMs).not.toBeNull();
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 0 });
  });

  it('surfaces HTTP errors with the provider message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"model not found"}', { status: 404, statusText: 'Not Found' }));
    await expect(callOpenAICompatible(target, { playbook: 'p', system: 's', user: 'u' }, { maxTokens: 5 })).rejects.toThrow(/404.*model not found/);
  });

  it('refuses to run without the API key it needs', async () => {
    await expect(callOpenAICompatible({ ...target, apiKeyEnv: 'BAKEOFF_TEST_MISSING_KEY' }, { playbook: 'p', system: 's', user: 'u' }, { maxTokens: 5 })).rejects.toThrow(/not set/);
  });
});
