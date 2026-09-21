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
