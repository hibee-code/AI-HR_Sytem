import dataSource from '../data-source';
import { AdminUserSeeder } from './admin-user.seeder';
import { ChecklistTemplatesSeeder } from './checklist-templates.seeder';
import { DepartmentsSeeder } from './departments.seeder';
import { LeavePolicySeeder } from './leave-policy.seeder';
import { RolesPermissionsSeeder } from './roles-permissions.seeder';
import type { Seeder } from './seeder.interface';

/**
 * `npm run seed` — populates a local/dev database. Every seeder is
 * idempotent. In production only two modes are allowed:
 *   --catalogue-only   sync roles/permissions (runs on every deploy)
 *   --bootstrap-admin  catalogue + the first ADMIN from SEED_ADMIN_EMAIL /
 *                      SEED_ADMIN_PASSWORD (skipped if that email exists)
 */
async function main(): Promise<void> {
  const catalogueOnly = process.argv.includes('--catalogue-only');
  const bootstrapAdmin = process.argv.includes('--bootstrap-admin');
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !catalogueOnly && !bootstrapAdmin) {
    throw new Error(
      'Refusing to seed a production database. Use --catalogue-only or --bootstrap-admin.',
    );
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (bootstrapAdmin && (!adminEmail || !adminPassword)) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD');
  }

  const seeders: Seeder[] = [new RolesPermissionsSeeder()];
  if (bootstrapAdmin) {
    seeders.push(new AdminUserSeeder(adminEmail!, adminPassword!));
  } else if (!catalogueOnly) {
    seeders.push(
      new AdminUserSeeder(
        adminEmail ?? 'admin@example.com',
        adminPassword ?? 'ChangeMe123!',
      ),
      new DepartmentsSeeder(),
      new ChecklistTemplatesSeeder(),
      new LeavePolicySeeder(),
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
