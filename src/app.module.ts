import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigModule } from './config/config.module';
import type { Env } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { PermissionsGuard } from './modules/rbac/guards/permissions.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // ── Cross-cutting infrastructure (order matters: config first) ─────────
    AppConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 20 }),
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
    RbacModule,
    UsersModule,
    AuthModule,
    EmployeesModule,
    NotificationsModule,
    OnboardingModule,
  ],
  providers: [
    // Global guards run in this order: rate limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
