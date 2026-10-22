/**
 * The e2e suite migrates, truncates tables and flushes Redis, so it must
 * only ever run against throwaway infrastructure. scripts/e2e-docker.sh
 * (`npm run test:e2e:docker`) starts that infrastructure, exports every
 * connection variable explicitly and sets E2E_ISOLATED=1. Without it we
 * refuse to start: the app's ConfigModule would otherwise fill any missing
 * DB_/REDIS_ value from .env and point the suite at a real database.
 */
if (process.env.E2E_ISOLATED !== '1') {
  throw new Error(
    'Refusing to run e2e tests outside isolated infrastructure. Use `npm run test:e2e:docker`.',
  );
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'fatal';
process.env.DB_NAME = process.env.DB_TEST_NAME ?? process.env.DB_NAME;
process.env.STORAGE_DRIVER = 'memory';
process.env.AI_DRIVER = 'fake';
