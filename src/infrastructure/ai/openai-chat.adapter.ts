import OpenAI from 'openai';
import type {
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/** OpenAI chat completions. */
export class OpenAiChatAdapter implements ChatModel {
  readonly provider = 'openai';
  private readonly client: OpenAI | null;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
  ) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new Error('OPENAI_API_KEY not configured');
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_completion_tokens: req.maxTokens,
      temperature: 0.2,
    });
    const text = res.choices[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('Empty completion from OpenAI');
    return {
      text,
      provider: this.provider,
      model: res.model,
      usage: res.usage
        ? {
            inputTokens: res.usage.prompt_tokens,
            outputTokens: res.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
