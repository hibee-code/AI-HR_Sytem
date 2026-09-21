import { InferenceClient } from '@huggingface/inference';
import type {
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/** Hugging Face Inference API chat completion (OpenAI-compatible messages). */
export class HfChatAdapter implements ChatModel {
  readonly provider = 'huggingface';
  private readonly client: InferenceClient | null;

  constructor(
    token: string | undefined,
    private readonly model: string,
  ) {
    this.client = token ? new InferenceClient(token) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new Error('HF_API_TOKEN not configured');
    const res = await this.client.chatCompletion({
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      temperature: 0.2,
    });
    const text = res.choices[0]?.message?.content ?? '';
    if (!text) throw new Error('Empty completion from Hugging Face');
    return {
      text,
      provider: this.provider,
      model: this.model,
      usage: res.usage
        ? {
            inputTokens: res.usage.prompt_tokens,
            outputTokens: res.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
