import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audit rows stay immutable, but retention may delete old ones: only inside a
 * transaction that set `app.audit_purge = 'on'` (RetentionService), and
 * never rows younger than 365 days — a floor the application can't lower.
 * Updates remain forbidden.
 */
export class AuditRetention1759700000000 implements MigrationInterface {
  name = 'AuditRetention1759700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE'
           AND current_setting('app.audit_purge', true) = 'on'
           AND OLD.created_at < now() - interval '365 days' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql`);
  }
}
