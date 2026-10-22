/**
 * List prices, USD per 1M tokens (input, output), for cost estimates in the
 * usage log. Estimates only: cache reads/writes and long-context tiers are
 * not modelled. Providers not listed (Hugging Face, OpenAI, fake) → null.
 */
const PRICES_PER_MTOK: Record<string, [input: number, output: number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-fable-5-1': [10, 50],
};

// Longest first so 'claude-opus-5-5' wins over 'claude-opus-5'.
const KEYS = Object.keys(PRICES_PER_MTOK).sort((a, b) => b.length - a.length);

export function estimateCostUsd(
  model: string,
  usage?: { inputTokens: number; outputTokens: number },
): number | null {
  const key = KEYS.find((k) => model.startsWith(k));
  if (!key || !usage) return null;
  const [inp, out] = PRICES_PER_MTOK[key];
  const cost = (usage.inputTokens * inp + usage.outputTokens * out) / 1e6;
  return Math.round(cost * 1e6) / 1e6;
}
