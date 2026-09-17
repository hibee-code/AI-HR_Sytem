import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema';
import { buildDataSourceOptions } from './typeorm.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        ...buildDataSourceOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
          DB_SSL: config.get('DB_SSL', { infer: true }),
          DB_LOGGING: config.get('DB_LOGGING', { infer: true }),
        }),
        // Entities are registered per feature module via TypeOrmModule.forFeature;
        // autoLoadEntities keeps the glob in typeorm.config.ts for the CLI only.
        autoLoadEntities: true,
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
  ],
})
export class DatabaseModule {}
