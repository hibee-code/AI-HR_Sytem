import type { DataSource } from 'typeorm';

/**
 * A seeder is idempotent: running it twice must not duplicate data.
 * Seeders run in the order they are listed in run-seed.ts.
 */
export interface Seeder {
  readonly name: string;
  run(dataSource: DataSource): Promise<void>;
}
