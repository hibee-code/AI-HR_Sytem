import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AdminUserSeeder } from '../../src/database/seeds/admin-user.seeder';
import { RolesPermissionsSeeder } from '../../src/database/seeds/roles-permissions.seeder';

export const ADMIN = { email: 'admin@test.local', password: 'AdminPassw0rd!' };

/**
 * Boots the real application against the e2e database (see setup-env.ts):
 * runs migrations, seeds roles/permissions and an admin, and returns the app.
 * Each suite gets a clean schema — tables are truncated on teardown — and a
 * clean Redis, so queued jobs left by the previous suite can't leak into it.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  ds: DataSource;
}> {
  await flushTestRedis();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const ds = app.get(DataSource);
  await ds.runMigrations();
  await ds.query('TRUNCATE TABLE notification_log');
  await new RolesPermissionsSeeder().run(ds);
  await new AdminUserSeeder(ADMIN.email, ADMIN.password).run(ds);

  return { app, ds };
}

export async function destroyTestApp(
  app: INestApplication,
  ds: DataSource,
): Promise<void> {
  await ds.query(
    'TRUNCATE TABLE one_time_tokens, refresh_tokens, user_roles, users RESTART IDENTITY CASCADE',
  );
  await app.close();
}

/** Empties the test Redis DB before workers start (destructive — test env only). */
async function flushTestRedis(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('refusing to flush Redis outside NODE_ENV=test');
  }
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    lazyConnect: true,
  });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
