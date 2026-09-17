import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // ── Cross-cutting infrastructure (order matters: config first) ─────────
    AppConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (
        config: ConfigService<Env, true>,
        storage: RedisThrottlerStorage,
      ) => ({
        throttlers: [
          {
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
        // Redis-backed so limits hold across multiple app instances.
        storage,
      }),
    }),

    // ── Feature modules (added one stage at a time) ────────────────────────
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
