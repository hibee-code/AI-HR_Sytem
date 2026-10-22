/**
 * Stub environment for app.module.spec.ts, imported before AppModule because
 * ConfigModule.forRoot() validates the env at import time. Explicit values,
 * so the spec never depends on a developer's .env (CI has none).
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DB_HOST: 'stub',
  DB_USERNAME: 'stub',
  DB_PASSWORD: 'stub',
  DB_NAME: 'stub',
  REDIS_HOST: 'stub',
  WORKERS_ENABLED: 'false',
  STORAGE_DRIVER: 'memory',
  AI_DRIVER: 'fake',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MFA_ENCRYPTION_KEY: 'c'.repeat(32),
});
