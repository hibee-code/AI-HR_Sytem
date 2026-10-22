import type { TokenUsage } from './chat-model.interface';

interface Price {
  /** USD per 1M tokens. */
  input: number;
  output: number;
  /** Higher rates once a prompt exceeds `above` tokens. */
  longContext?: { above: number; input: number; output: number };
}

/**
 * List prices for cost estimates in the usage log. Cache reads bill at 0.1×
 * input and 5-minute cache writes at 1.25× input. Providers not listed
 * (Hugging Face, OpenAI, fake) → null. Batch / priority tiers not modelled.
 */
const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    longContext: { above: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

// Longest first so 'claude-opus-5-5' wins over 'claude-opus-5'.
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

export function estimateCostUsd(
  model: string,
  usage?: TokenUsage,
): number | null {
  const key = KEYS.find((k) => model.startsWith(k));
  if (!key || !usage) return null;
  const p = PRICES[key];
  const long = p.longContext && usage.inputTokens > p.longContext.above;
  const inRate = long ? p.longContext!.input : p.input;
  const outRate = long ? p.longContext!.output : p.output;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const cost =
    (uncached * inRate +
      cacheRead * inRate * CACHE_READ_MULTIPLIER +
      cacheWrite * inRate * CACHE_WRITE_MULTIPLIER +
      usage.outputTokens * outRate) /
    1e6;
  return Math.round(cost * 1e6) / 1e6;
}
