export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatTurn[];
  /** Upper bound on generated tokens. */
  maxTokens: number;
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * One LLM provider. `isConfigured` is a cheap static check (credentials
 * present); `complete` may still fail at runtime — the fallback chain
 * handles that.
 */
export interface ChatModel {
  readonly provider: string;
  isConfigured(): boolean;
  complete(request: ChatRequest): Promise<ChatResponse>;
  /** Optional token streaming: yields text deltas, returns the final response. */
  stream?(request: ChatRequest): AsyncGenerator<string, ChatResponse>;
}

/** Streams from any model; ones without native streaming yield their whole answer once. */
export async function* streamOf(
  model: ChatModel,
  request: ChatRequest,
): AsyncGenerator<string, ChatResponse> {
  if (model.stream) return yield* model.stream(request);
  const res = await model.complete(request);
  yield res.text;
  return res;
}

/** The composed chain that callers depend on (never a single provider). */
export const CHAT_MODEL = Symbol('CHAT_MODEL');

export class AllProvidersFailedError extends Error {
  constructor(public readonly attempts: { provider: string; error: string }[]) {
    super(
      `All chat providers failed: ${attempts.map((a) => `${a.provider} (${a.error})`).join('; ')}`,
    );
  }
}
