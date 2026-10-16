import Anthropic from '@anthropic-ai/sdk';
import type { CallResult, Prompt, Target } from '../types';
import type { CallOptions } from './index';

/**
 * Claude through the Messages API, streamed.
 *
 * - The playbook goes in its own system block. With `promptCaching` on it
 *   gets a cache breakpoint, so repeat calls read it from cache and the
 *   usage shows cache_read_input_tokens.
 * - Current Claude models think adaptively and can't turn it off; `effort`
 *   is the lever. Thinking tokens bill as output and arrive before the
 *   first visible text, so TTFT here means "first visible token".
 * - No server-side refusal fallback on purpose: a fallback would quietly
 *   swap the model mid-benchmark. A refusal is recorded as a failure.
 */
let client: Anthropic | null = null;

export async function callAnthropic(target: Target, prompt: Prompt, opts: CallOptions): Promise<CallResult> {
  if (target.apiKeyEnv && !process.env[target.apiKeyEnv]) throw new Error(`${target.label}: ${target.apiKeyEnv} is not set`);
  client ??= new Anthropic({ maxRetries: 0 });

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: prompt.playbook, ...(target.promptCaching ? { cache_control: { type: 'ephemeral' as const } } : {}) },
    { type: 'text', text: prompt.system },
  ];

  const started = performance.now();
  let ttftMs: number | null = null;
  let text = '';

  const stream = client.messages.stream(
    {
      model: target.model,
      max_tokens: opts.maxTokens + 2_000, // headroom for thinking at low effort
      system,
      messages: [{ role: 'user', content: prompt.user }],
      ...(target.effort ? { output_config: { effort: target.effort } } : {}),
    },
    { signal: opts.signal }
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      if (ttftMs == null) ttftMs = performance.now() - started;
      text += event.delta.text;
      opts.onToken?.(event.delta.text);
    }
  }
  const message = await stream.finalMessage();
  if (message.stop_reason === 'refusal') throw new Error('Model declined the request (stop_reason: refusal)');

  return {
    text,
    ttftMs,
    totalMs: performance.now() - started,
    usage: {
      // input_tokens excludes cache reads/writes; report the total so every provider means the same thing.
      inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
