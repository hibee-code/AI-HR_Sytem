import type Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicChatAdapter,
  anthropicCapabilities,
} from './anthropic-chat.adapter';
import type { ChatRequest } from './chat-model.interface';

const req: ChatRequest = {
  system: 'You are the HR assistant.',
  messages: [{ role: 'user', content: 'How many leave days do I get?' }],
  maxTokens: 8192,
};

function reply(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'You get 20 days [1].' },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  };
}

function adapterFor(model: string, response = reply()) {
  const create = jest.fn().mockResolvedValue(response);
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return {
    adapter: new AnthropicChatAdapter(undefined, model, 'low', client),
    create,
  };
}

describe('anthropicCapabilities', () => {
  it.each([
    ['claude-haiku-5-5', true, true, false],
    ['claude-sonnet-5-5', true, true, true],
    ['claude-opus-5-5', true, true, true],
    ['claude-opus-5', true, true, true],
    ['claude-fable-5-1', true, true, true],
    ['claude-opus-4-8', true, true, false],
    ['claude-sonnet-4-6', true, true, false],
    ['claude-haiku-4-5', false, false, false],
    ['claude-sonnet-4-5', false, false, false],
    ['claude-opus-4-1', false, false, false],
    ['claude-sonnet-4-20250514', false, false, false],
    ['claude-3-5-haiku-latest', false, false, false],
  ])('%s → adaptive=%s effort=%s fallback=%s', (model, a, e, f) => {
    expect(anthropicCapabilities(model)).toEqual({
      adaptiveThinking: a,
      effort: e,
      serverFallback: f,
    });
  });
});

describe('AnthropicChatAdapter', () => {
  it('is unconfigured without a key or client', () => {
    expect(
      new AnthropicChatAdapter(undefined, 'claude-haiku-5-5').isConfigured(),
    ).toBe(false);
  });

  it('Haiku 5.5: adaptive thinking + effort, no server-side fallback', async () => {
    const { adapter, create } = adapterFor('claude-haiku-5-5');
    const res = await adapter.complete(req);

    const params = create.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
    expect(params.max_tokens).toBe(8192);
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });

    expect(res).toEqual({
      text: 'You get 20 days [1].',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      usage: { inputTokens: 120, outputTokens: 40 },
    });
  });

  it('Haiku 4.5: sends neither thinking, effort nor fallbacks', async () => {
    const { adapter, create } = adapterFor('claude-haiku-4-5');
    await adapter.complete(req);
    const params = create.mock.calls[0][0];
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('output_config');
    expect(params).not.toHaveProperty('fallbacks');
  });

  it('Opus 5.5: opts into the server-side refusal fallback', async () => {
    const { adapter, create } = adapterFor('claude-opus-5-5');
    await adapter.complete(req);
    const params = create.mock.calls[0][0];
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
  });

  it('throws on refusal so the chain falls through', async () => {
    const { adapter } = adapterFor(
      'claude-haiku-5-5',
      reply({ stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    );
    await expect(adapter.complete(req)).rejects.toThrow(/declined.*cyber/);
  });

  it('throws on max_tokens rather than returning a truncated answer', async () => {
    const { adapter } = adapterFor(
      'claude-haiku-5-5',
      reply({ stop_reason: 'max_tokens' }),
    );
    await expect(adapter.complete(req)).rejects.toThrow(/AI_MAX_OUTPUT_TOKENS/);
  });

  it('throws when there is no text block', async () => {
    const { adapter } = adapterFor(
      'claude-haiku-5-5',
      reply({ content: [{ type: 'thinking', thinking: '' }] }),
    );
    await expect(adapter.complete(req)).rejects.toThrow(/Empty completion/);
  });
});
