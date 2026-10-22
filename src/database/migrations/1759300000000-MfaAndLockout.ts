import { MigrationInterface, QueryRunner } from 'typeorm';

/** TOTP MFA (sealed seed, replay guard, hashed recovery codes) and login lockout. */
export class MfaAndLockout1759300000000 implements MigrationInterface {
  name = 'MfaAndLockout1759300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "users"
        ADD "mfa_enabled"           boolean NOT NULL DEFAULT false,
        ADD "mfa_secret"            varchar(255),
        ADD "mfa_last_step"         bigint,
        ADD "mfa_recovery_codes"    jsonb NOT NULL DEFAULT '[]',
        ADD "failed_login_attempts" integer NOT NULL DEFAULT 0,
        ADD "locked_until"          timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "users"
        DROP COLUMN "locked_until",
        DROP COLUMN "failed_login_attempts",
        DROP COLUMN "mfa_recovery_codes",
        DROP COLUMN "mfa_last_step",
        DROP COLUMN "mfa_secret",
        DROP COLUMN "mfa_enabled"`);
  }
}
