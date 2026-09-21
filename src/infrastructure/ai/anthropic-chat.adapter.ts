import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/**
 * Claude via the official Anthropic SDK. Thinking runs adaptively (the
 * Opus 5 default); the server-side refusal fallback is enabled so a policy
 * decline is re-run on a fallback model inside the same call.
 */
export class AnthropicChatAdapter implements ChatModel {
  readonly provider = 'anthropic';
  private readonly client: Anthropic | null;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
  ) {
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY not configured');
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `Claude declined the request (${response.stop_details?.category ?? 'refusal'})`,
      );
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('Empty completion from Anthropic');
    return {
      text,
      provider: this.provider,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
