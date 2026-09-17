import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { envSchema } from '../config/env.schema';
import { buildDataSourceOptions } from './typeorm.config';

/**
 * TypeORM CLI entry point only (migrations / seeds):
 *   npm run typeorm -- migration:generate src/database/migrations/Name
 *
 * The Nest app does NOT import this file; it uses DatabaseModule, which builds
 * the same options from the validated ConfigService.
 */
const env = envSchema
  .pick({
    DB_HOST: true,
    DB_PORT: true,
    DB_USERNAME: true,
    DB_PASSWORD: true,
    DB_NAME: true,
    DB_SSL: true,
    DB_LOGGING: true,
  })
  .parse(process.env);

const dataSource = new DataSource(buildDataSourceOptions(env));
export default dataSource;
