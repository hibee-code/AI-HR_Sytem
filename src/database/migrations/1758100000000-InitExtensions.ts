import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline: enable the Postgres extensions the system depends on.
 *  - vector  : pgvector, embeddings for the RAG knowledge base
 *  - citext  : case-insensitive emails / usernames
 *  - pgcrypto: gen_random_uuid() (built-in on PG13+, kept for portability)
 */
export class InitExtensions1758100000000 implements MigrationInterface {
  name = 'InitExtensions1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "citext"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "vector"');
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Extensions are intentionally left in place on revert; dropping "vector"
    // would cascade-drop any embedding columns.
  }
}
