import { MigrationInterface, QueryRunner } from 'typeorm';

/** One row per LLM call: feature, model, tokens, estimated cost; backs the daily cap. */
export class AiUsage1759400000000 implements MigrationInterface {
  name = 'AiUsage1759400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "ai_usage" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "user_id"       uuid,
        "feature"       varchar(30) NOT NULL,
        "provider"      varchar(30) NOT NULL,
        "model"         varchar(100) NOT NULL,
        "input_tokens"  integer NOT NULL DEFAULT 0,
        "output_tokens" integer NOT NULL DEFAULT 0,
        "cost_usd"      numeric(12,6),
        CONSTRAINT "PK_3dddab3a15520a9c3eba859195d" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE INDEX "idx_ai_usage_created" ON "ai_usage" ("created_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_ai_usage_user_created" ON "ai_usage" ("user_id", "created_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "ai_usage"`);
  }
}
