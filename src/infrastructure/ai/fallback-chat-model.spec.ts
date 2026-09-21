import type { Logger } from 'nestjs-pino';
import {
  AllProvidersFailedError,
  ChatModel,
  ChatRequest,
} from './chat-model.interface';
import { FallbackChatModel } from './fallback-chat-model';

class Stub implements ChatModel {
  calls = 0;
  constructor(
    readonly provider: string,
    private readonly configured: boolean,
    private behaviour: 'ok' | 'fail' = 'ok',
  ) {}
  isConfigured() {
    return this.configured;
  }
  set(b: 'ok' | 'fail') {
    this.behaviour = b;
  }
  async complete(_req: ChatRequest) {
    this.calls++;
    if (this.behaviour === 'fail') throw new Error(`${this.provider} down`);
    return {
      text: `answer from ${this.provider}`,
      provider: this.provider,
      model: 'm',
    };
  }
}

const req: ChatRequest = {
  system: 's',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 100,
};
const warn = jest.fn();
const logger = { warn } as unknown as Logger;

describe('FallbackChatModel', () => {
  let clock = 0;
  const now = () => clock;
  beforeEach(() => {
    clock = 0;
    jest.clearAllMocks();
  });

  it('uses the first configured provider and skips unconfigured ones', async () => {
    const hf = new Stub('huggingface', false);
    const claude = new Stub('anthropic', true);
    const openai = new Stub('openai', true);
    const chain = new FallbackChatModel(
      [hf, claude, openai],
      logger,
      60_000,
      now,
    );

    expect(chain.configured).toEqual(['anthropic', 'openai']);
    expect((await chain.complete(req)).provider).toBe('anthropic');
    expect(hf.calls).toBe(0);
    expect(openai.calls).toBe(0);
  });

  it('falls through to the next provider on failure and records a cooldown', async () => {
    const hf = new Stub('huggingface', true, 'fail');
    const claude = new Stub('anthropic', true);
    const chain = new FallbackChatModel([hf, claude], logger, 60_000, now);

    expect((await chain.complete(req)).provider).toBe('anthropic');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'huggingface' }),
      expect.any(String),
    );
    expect(chain.unhealthy).toEqual(['huggingface']);

    // Next call goes straight to anthropic without re-trying huggingface.
    await chain.complete(req);
    expect(hf.calls).toBe(1);
    expect(claude.calls).toBe(2);
  });

  it('retries a cooled-down provider after the cooldown elapses', async () => {
    const hf = new Stub('huggingface', true, 'fail');
    const claude = new Stub('anthropic', true);
    const chain = new FallbackChatModel([hf, claude], logger, 60_000, now);

    await chain.complete(req);
    hf.set('ok');
    clock = 61_000;
    expect((await chain.complete(req)).provider).toBe('huggingface');
    expect(chain.unhealthy).toEqual([]);
  });

  it('when every provider is cooling down, tries them all anyway', async () => {
    const hf = new Stub('huggingface', true, 'fail');
    const claude = new Stub('anthropic', true, 'fail');
    const chain = new FallbackChatModel([hf, claude], logger, 60_000, now);

    await expect(chain.complete(req)).rejects.toThrow(AllProvidersFailedError);
    claude.set('ok');
    expect((await chain.complete(req)).provider).toBe('anthropic'); // still on cooldown, but attempted
  });

  it('reports every attempt when all fail, and a clear error when nothing is configured', async () => {
    const chain = new FallbackChatModel(
      [new Stub('huggingface', true, 'fail'), new Stub('openai', true, 'fail')],
      logger,
      60_000,
      now,
    );
    const err = (await chain
      .complete(req)
      .catch((e) => e)) as AllProvidersFailedError;
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect(err.attempts.map((a) => a.provider)).toEqual([
      'huggingface',
      'openai',
    ]);

    const empty = new FallbackChatModel(
      [new Stub('anthropic', false)],
      logger,
      60_000,
      now,
    );
    expect(empty.isConfigured()).toBe(false);
    await expect(empty.complete(req)).rejects.toThrow(
      /no chat provider configured/,
    );
  });
});
