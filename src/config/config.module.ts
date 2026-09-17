import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './env.schema';

/**
 * Global, validated configuration. Inject `ConfigService<Env, true>` anywhere;
 * the `true` generic marks every key as guaranteed-present after validation.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // .env is for local development only; in containers/prod the env is injected.
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppConfigModule {}
