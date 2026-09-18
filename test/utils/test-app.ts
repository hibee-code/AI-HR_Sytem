import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AdminUserSeeder } from '../../src/database/seeds/admin-user.seeder';
import { RolesPermissionsSeeder } from '../../src/database/seeds/roles-permissions.seeder';

export const ADMIN = { email: 'admin@test.local', password: 'AdminPassw0rd!' };

/**
 * Boots the real application against the e2e database (see setup-env.ts):
 * runs migrations, seeds roles/permissions and an admin, and returns the app.
 * Each suite gets a clean schema — tables are truncated on teardown.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  ds: DataSource;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const ds = app.get(DataSource);
  await ds.runMigrations();
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
