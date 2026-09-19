/**
 * e2e tests run against the docker-compose Postgres/Redis (or whatever
 * .env.test points at). Values here are fallbacks so `npm run test:e2e`
 * works out of the box against the default compose stack.
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'fatal';
process.env.DB_NAME =
  process.env.DB_TEST_NAME ?? process.env.DB_NAME ?? 'hr_system_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-0000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-00';
process.env.STORAGE_DRIVER = 'memory';
