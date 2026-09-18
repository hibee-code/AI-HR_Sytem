import dataSource from '../data-source';
import { AdminUserSeeder } from './admin-user.seeder';
import { DepartmentsSeeder } from './departments.seeder';
import { RolesPermissionsSeeder } from './roles-permissions.seeder';
import type { Seeder } from './seeder.interface';

/**
 * `npm run seed` — populates a local/dev database. Every seeder is
 * idempotent. Refuses to run in production: use `seed:catalogue` there.
 */
async function main(): Promise<void> {
  const catalogueOnly = process.argv.includes('--catalogue-only');
  if (process.env.NODE_ENV === 'production' && !catalogueOnly) {
    throw new Error(
      'Refusing to seed a production database. Use `npm run seed:catalogue` to sync roles/permissions only.',
    );
  }

  const seeders: Seeder[] = [new RolesPermissionsSeeder()];
  if (!catalogueOnly) {
    seeders.push(
      new AdminUserSeeder(
        process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com',
        process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
      ),
      new DepartmentsSeeder(),
    );
  }

  await dataSource.initialize();
  try {
    for (const seeder of seeders) {
      process.stdout.write(`→ ${seeder.name} ... `);
      await seeder.run(dataSource);
      process.stdout.write('done\n');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
