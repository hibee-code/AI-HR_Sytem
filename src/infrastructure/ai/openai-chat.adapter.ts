import OpenAI from 'openai';
import type {
  ChatModel,
  ChatRequest,
  ChatResponse,
} from './chat-model.interface';

/**
 * OpenAI chat completions — and any OpenAI-compatible server, which is how
 * open models run locally (Ollama, llama.cpp, vLLM): pass `baseURL` and the
 * adapter reports itself as the `local` provider.
 */
export class OpenAiChatAdapter implements ChatModel {
  readonly provider: string;
  private readonly client: OpenAI | null;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
    options: { baseURL?: string; provider?: string; timeoutMs?: number } = {},
  ) {
    this.provider = options.provider ?? 'openai';
    // Local servers don't check keys, but the SDK requires one.
    const key = apiKey ?? (options.baseURL ? 'local' : undefined);
    this.client = key
      ? new OpenAI({
          apiKey: key,
          baseURL: options.baseURL,
          timeout: options.timeoutMs ?? 60_000,
          maxRetries: 1,
        })
      : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async complete(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.requireClient().chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_completion_tokens: req.maxTokens,
      temperature: 0.2,
    });
    const text = res.choices[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error(`Empty completion from ${this.provider}`);
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

  /** Token streaming — matters most for slow CPU-hosted local models. */
  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const stream = await this.requireClient().chat.completions.create({
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_completion_tokens: req.maxTokens,
      temperature: 0.2,
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = '';
    let model = this.model;
    let usage: ChatResponse['usage'];
    for await (const chunk of stream) {
      model = chunk.model ?? model;
      if (chunk.usage)
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield delta;
      }
    }
    if (!text.trim()) throw new Error(`Empty completion from ${this.provider}`);
    return { text: text.trim(), provider: this.provider, model, usage };
  }

  private requireClient(): OpenAI {
    if (!this.client) throw new Error(`${this.provider} is not configured`);
    return this.client;
  }
}
