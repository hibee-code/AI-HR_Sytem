import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only audit trail. A trigger rejects UPDATE/DELETE so rows can't be
 * rewritten even by the application's own database user.
 */
export class AuditLog1759200000000 implements MigrationInterface {
  name = 'AuditLog1759200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "audit_logs" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "actor_user_id" uuid,
        "action"        varchar(100) NOT NULL,
        "resource_type" varchar(50) NOT NULL,
        "resource_id"   varchar(100),
        "ip_address"    varchar(64),
        "user_agent"    varchar(512),
        "metadata"      jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("created_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("actor_user_id", "created_at")`,
    );
    await q.query(
      `CREATE INDEX "idx_audit_logs_resource" ON "audit_logs" ("resource_type", "resource_id")`,
    );
    await q.query(`
      CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE TRIGGER "trg_audit_logs_immutable"
        BEFORE UPDATE OR DELETE ON "audit_logs"
        FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "audit_logs"`);
    await q.query(`DROP FUNCTION audit_logs_immutable()`);
  }
}
