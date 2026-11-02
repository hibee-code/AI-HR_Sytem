import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { AnthropicChatAdapter } from './anthropic-chat.adapter';
import { CHAT_MODEL, ChatModel } from './chat-model.interface';
import {
  DOCUMENT_READER,
  NO_DOCUMENT_READER,
} from './document-reader.interface';
import { EMBEDDINGS_PROVIDER } from './embeddings.interface';
import { FakeChatAdapter } from './fake-chat.adapter';
import { FakeEmbeddingsProvider } from './fake-embeddings.provider';
import { FallbackChatModel } from './fallback-chat-model';
import { HfChatAdapter } from './hf-chat.adapter';
import { HfEmbeddingsProvider } from './hf-embeddings.provider';
import { LocalEmbeddingsProvider } from './local-embeddings.provider';
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
        switch (config.get('EMBEDDINGS_DRIVER', { infer: true })) {
          case 'fake':
            return new FakeEmbeddingsProvider(dims);
          case 'huggingface': {
            const token = config.get('HF_API_TOKEN', { infer: true });
            if (!token)
              throw new Error(
                'HF_API_TOKEN is required when EMBEDDINGS_DRIVER=huggingface',
              );
            return new HfEmbeddingsProvider(
              token,
              config.get('HF_EMBEDDING_MODEL', { infer: true }),
              dims,
            );
          }
          case 'local':
            return new LocalEmbeddingsProvider(
              config.get('LOCAL_EMBEDDING_MODEL', { infer: true }),
              dims,
              config.get('EMBEDDINGS_CACHE_DIR', { infer: true }),
              {
                query: config.get('EMBEDDING_QUERY_PREFIX', { infer: true }),
                document: config.get('EMBEDDING_DOCUMENT_PREFIX', {
                  infer: true,
                }),
              },
            );
        }
      },
    },
    {
      // Scanned-PDF reading: Claude only (other providers can't read PDFs here).
      provide: DOCUMENT_READER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('AI_DRIVER', { infer: true }) === 'fake'
          ? NO_DOCUMENT_READER
          : anthropicFrom(config),
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
          anthropic: anthropicFrom(config),
          openai: new OpenAiChatAdapter(
            config.get('OPENAI_API_KEY', { infer: true }),
            config.get('OPENAI_MODEL', { infer: true }),
          ),
          // Open model on an OpenAI-compatible server (Ollama). Unset URL = skipped.
          local: new OpenAiChatAdapter(
            undefined,
            config.get('LOCAL_LLM_MODEL', { infer: true }),
            {
              baseURL: config.get('LOCAL_LLM_BASE_URL', { infer: true }),
              provider: 'local',
              timeoutMs: 180_000, // CPU inference is slow
            },
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
  exports: [EMBEDDINGS_PROVIDER, CHAT_MODEL, DOCUMENT_READER],
})
export class AiInfrastructureModule {}

function anthropicFrom(config: ConfigService<Env, true>): AnthropicChatAdapter {
  return new AnthropicChatAdapter(
    config.get('ANTHROPIC_API_KEY', { infer: true }),
    config.get('ANTHROPIC_MODEL', { infer: true }),
    config.get('ANTHROPIC_EFFORT', { infer: true }),
  );
}
