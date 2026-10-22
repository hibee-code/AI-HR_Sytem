/**
 * Deploy step: `node dist/database/migrate.js` (runs before the API starts).
 * Pending migrations + permission-catalogue sync under a Postgres advisory
 * lock, so replicas starting together don't race: the second one waits,
 * then finds nothing left to do.
 */
import dataSource from './data-source';
import { RolesPermissionsSeeder } from './seeds/roles-permissions.seeder';

/** Arbitrary, stable key identifying "schema changes for this app". */
const MIGRATION_LOCK_KEY = 762_839_001;

async function main(): Promise<void> {
  await dataSource.initialize();
  const lock = dataSource.createQueryRunner();
  await lock.connect();
  try {
    console.log('migrate: waiting for lock');
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const applied = await dataSource.runMigrations();
    console.log(
      applied.length
        ? `migrate: applied ${applied.map((m) => m.name).join(', ')}`
        : 'migrate: schema up to date',
    );
    await new RolesPermissionsSeeder().run(dataSource);
    console.log('migrate: permission catalogue synced');
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await lock.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
