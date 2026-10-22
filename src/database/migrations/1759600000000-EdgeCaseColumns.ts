import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll: per-run FX rates, employer costs per payslip. Leave: per-year
 * allocations (requests across 31 Dec). AI usage: cache tokens, aborted streams.
 */
export class EdgeCaseColumns1759600000000 implements MigrationInterface {
  name = 'EdgeCaseColumns1759600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "payroll_runs" ADD "fx_rates" jsonb NOT NULL DEFAULT '{}'`,
    );
    await q.query(
      `ALTER TABLE "payslips" ADD "employer_costs" jsonb NOT NULL DEFAULT '[]'`,
    );
    await q.query(`ALTER TABLE "leave_requests" ADD "allocations" jsonb`);
    await q.query(`
      ALTER TABLE "ai_usage"
        ADD "cache_read_tokens"  integer NOT NULL DEFAULT 0,
        ADD "cache_write_tokens" integer NOT NULL DEFAULT 0,
        ADD "aborted"            boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "ai_usage"
        DROP COLUMN "aborted",
        DROP COLUMN "cache_write_tokens",
        DROP COLUMN "cache_read_tokens"`);
    await q.query(`ALTER TABLE "leave_requests" DROP COLUMN "allocations"`);
    await q.query(`ALTER TABLE "payslips" DROP COLUMN "employer_costs"`);
    await q.query(`ALTER TABLE "payroll_runs" DROP COLUMN "fx_rates"`);
  }
}
