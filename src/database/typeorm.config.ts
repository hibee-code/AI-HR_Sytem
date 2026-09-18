import * as path from 'node:path';
import type { DataSourceOptions } from 'typeorm';

export type DatabaseEnv = {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  DB_SSL: boolean;
  DB_LOGGING: boolean;
};

/**
 * Builds TypeORM options from an already-validated env object.
 * Used by both the Nest app (DatabaseModule) and the TypeORM CLI (data-source.ts)
 * so the two can never drift apart.
 *
 * `synchronize` is hard-coded false: schema changes go through migrations only.
 */
export function buildDataSourceOptions(env: DatabaseEnv): DataSourceOptions {
  // __dirname is src/database under ts-node and dist/database when compiled,
  // so the same globs resolve in both modes.
  const ext = path.extname(__filename); // ".ts" or ".js"
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
    synchronize: false,
    // gen_random_uuid() from pgcrypto (built into PG13+); avoids uuid-ossp.
    uuidExtension: 'pgcrypto',
    logging: env.DB_LOGGING,
    entities: [path.join(__dirname, '..', 'modules', '**', '*.entity' + ext)],
    migrations: [path.join(__dirname, 'migrations', '*' + ext)],
    migrationsTableName: 'typeorm_migrations',
    migrationsRun: false,
    extra: {
      max: 20, // pool size
      idleTimeoutMillis: 30_000,
    },
  };
}
