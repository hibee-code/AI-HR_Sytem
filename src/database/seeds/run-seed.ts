import dataSource from '../data-source';
import type { Seeder } from './seeder.interface';

/**
 * `npm run seed` — populates a local/dev database.
 * Each stage registers its seeders here (roles & permissions, admin user,
 * sample departments, ...). Never run against production.
 */
const seeders: Seeder[] = [
  // stage 1: RolesAndPermissionsSeeder, AdminUserSeeder
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  await dataSource.initialize();
  try {
    for (const seeder of seeders) {
      process.stdout.write(`→ ${seeder.name} ... `);
      await seeder.run(dataSource);
      process.stdout.write('done\n');
    }
    if (seeders.length === 0) {
      console.log('No seeders registered yet.');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
