import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 3: notification delivery log and per-user preferences. */
export class Notifications1758400000000 implements MigrationInterface {
  name = 'Notifications1758400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SLACK')`,
    );
    await q.query(
      `CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')`,
    );

    await q.query(`
      CREATE TABLE "notification_log" (
        "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
        "channel"           "notification_channel" NOT NULL,
        "template"          varchar(50) NOT NULL,
        "recipient_user_id" uuid,
        "recipient_address" varchar(254),
        "status"            "notification_status" NOT NULL DEFAULT 'QUEUED',
        "dedupe_key"        varchar(200),
        "payload"           jsonb NOT NULL DEFAULT '{}',
        "job_id"            varchar(100),
        "attempts"          integer NOT NULL DEFAULT 0,
        "error"             varchar(1000),
        "provider_ref"      varchar(200),
        "sent_at"           timestamptz,
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_6f761cfbbd064e0f326960877d6" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE INDEX "idx_notification_log_recipient_user_id" ON "notification_log" ("recipient_user_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_notification_log_status" ON "notification_log" ("status")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_notification_log_dedupe_key" ON "notification_log" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL`,
    );

    await q.query(`
      CREATE TABLE "notification_preferences" (
        "user_id"       uuid NOT NULL,
        "email_enabled" boolean NOT NULL DEFAULT true,
        "slack_enabled" boolean NOT NULL DEFAULT true,
        "slack_user_id" varchar(50),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_64c90edc7310c6be7c10c96f675" PRIMARY KEY ("user_id"),
        CONSTRAINT "REL_64c90edc7310c6be7c10c96f67" UNIQUE ("user_id"),
        CONSTRAINT "FK_64c90edc7310c6be7c10c96f675" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "notification_preferences"`);
    await q.query(`DROP TABLE "notification_log"`);
    await q.query(`DROP TYPE "notification_status"`);
    await q.query(`DROP TYPE "notification_channel"`);
  }
}
