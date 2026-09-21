import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { AnthropicChatAdapter } from './anthropic-chat.adapter';
import { CHAT_MODEL, ChatModel } from './chat-model.interface';
import { EMBEDDINGS_PROVIDER } from './embeddings.interface';
import { FakeChatAdapter } from './fake-chat.adapter';
import { FakeEmbeddingsProvider } from './fake-embeddings.provider';
import { FallbackChatModel } from './fallback-chat-model';
import { HfChatAdapter } from './hf-chat.adapter';
import { HfEmbeddingsProvider } from './hf-embeddings.provider';
import { OpenAiChatAdapter } from './openai-chat.adapter';

/**
 * Wires the embedding provider and the chat fallback chain from env.
 * AI_DRIVER=fake swaps both for deterministic in-process fakes (tests, offline dev).
 * AI_CHAT_PROVIDERS orders the chain; unconfigured providers are skipped.
 */
@Module({
  providers: [
    {
      provide: EMBEDDINGS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const dims = config.get('EMBEDDING_DIMENSIONS', { infer: true });
        if (config.get('AI_DRIVER', { infer: true }) === 'fake')
          return new FakeEmbeddingsProvider(dims);
        const token = config.get('HF_API_TOKEN', { infer: true });
        if (!token)
          throw new Error(
            'HF_API_TOKEN is required for embeddings when AI_DRIVER=live',
          );
        return new HfEmbeddingsProvider(
          token,
          config.get('HF_EMBEDDING_MODEL', { infer: true }),
          dims,
        );
      },
    },
    {
      provide: CHAT_MODEL,
      inject: [ConfigService, Logger],
      useFactory: (config: ConfigService<Env, true>, logger: Logger) => {
        if (config.get('AI_DRIVER', { infer: true }) === 'fake') {
          return new FallbackChatModel([new FakeChatAdapter()], logger);
        }
        const adapters: Record<string, ChatModel> = {
          huggingface: new HfChatAdapter(
            config.get('HF_API_TOKEN', { infer: true }),
            config.get('HF_CHAT_MODEL', { infer: true }),
          ),
          anthropic: new AnthropicChatAdapter(
            config.get('ANTHROPIC_API_KEY', { infer: true }),
            config.get('ANTHROPIC_MODEL', { infer: true }),
          ),
          openai: new OpenAiChatAdapter(
            config.get('OPENAI_API_KEY', { infer: true }),
            config.get('OPENAI_MODEL', { infer: true }),
          ),
        };
        const chain = config
          .get('AI_CHAT_PROVIDERS', { infer: true })
          .map((name) => adapters[name]);
        const model = new FallbackChatModel(chain, logger);
        logger.log(
          {
            configured: model.configured,
            order: config.get('AI_CHAT_PROVIDERS', { infer: true }),
          },
          'chat provider chain',
        );
        if (!model.isConfigured())
          logger.warn(
            'No chat provider has credentials; the assistant will return 503',
          );
        return model;
      },
    },
  ],
  exports: [EMBEDDINGS_PROVIDER, CHAT_MODEL],
})
export class AiInfrastructureModule {}
