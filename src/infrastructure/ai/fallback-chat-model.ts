import { Logger } from 'nestjs-pino';
import {
  AllProvidersFailedError,
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/** After a failure a provider is skipped for this long before being retried. */
export const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Tries providers in order and falls through on any error (network, rate
 * limit, auth, 5xx, refusal, empty output). A provider that just failed is
 * put on cooldown so the next request goes straight to the next healthy one;
 * it's retried after the cooldown or when everything else is down too.
 */
export class FallbackChatModel implements ChatModel {
  readonly provider = 'fallback-chain';
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly chain: ChatModel[],
    private readonly logger: Logger,
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Providers with credentials, in configured order. */
  get configured(): string[] {
    return this.chain.filter((m) => m.isConfigured()).map((m) => m.provider);
  }

  isConfigured(): boolean {
    return this.configured.length > 0;
  }

  /** Providers currently on cooldown (for the status endpoint). */
  get unhealthy(): string[] {
    const t = this.now();
    return [...this.cooldownUntil.entries()]
      .filter(([, until]) => until > t)
      .map(([p]) => p);
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    const candidates = this.chain.filter((m) => m.isConfigured());
    if (candidates.length === 0) {
      throw new AllProvidersFailedError([
        { provider: 'none', error: 'no chat provider configured' },
      ]);
    }
    const healthy = candidates.filter((m) => !this.onCooldown(m.provider));
    // If everything is cooling down, try them all anyway rather than fail fast.
    const order = healthy.length > 0 ? healthy : candidates;

    const attempts: { provider: string; error: string }[] = [];
    for (const model of order) {
      try {
        const res = await model.complete(req);
        this.cooldownUntil.delete(model.provider);
        return res;
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        attempts.push({ provider: model.provider, error: message });
        this.cooldownUntil.set(model.provider, this.now() + this.cooldownMs);
        this.logger.warn(
          { provider: model.provider, err: message },
          'chat provider failed; falling back',
        );
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  private onCooldown(provider: string): boolean {
    return (this.cooldownUntil.get(provider) ?? 0) > this.now();
  }
}
