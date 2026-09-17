import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import type { Env } from '../../config/env.schema';
import { RedisThrottlerStorage } from './redis-throttler.storage';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_OPTIONS = Symbol('REDIS_OPTIONS');

/** Plain options object; BullMQ builds its own connections from this. */
export function buildRedisOptions(
  config: ConfigService<Env, true>,
): RedisOptions {
  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
    password: config.get('REDIS_PASSWORD', { infer: true }),
    db: config.get('REDIS_DB', { infer: true }),
    // BullMQ requires this to be null on its own connections; harmless here.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

/**
 * Single shared ioredis client for caching / rate-limit storage / health.
 * Queues (BullMQ) get their own connection from REDIS_OPTIONS.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_OPTIONS,
      inject: [ConfigService],
      useFactory: buildRedisOptions,
    },
    {
      provide: REDIS_CLIENT,
      inject: [REDIS_OPTIONS],
      useFactory: (opts: RedisOptions) => new Redis(opts),
    },
    RedisThrottlerStorage,
  ],
  exports: [REDIS_CLIENT, REDIS_OPTIONS, RedisThrottlerStorage],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
