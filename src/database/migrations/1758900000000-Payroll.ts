import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 8: salary structures, payroll runs, payslips. */
export class Payroll1758900000000 implements MigrationInterface {
  name = 'Payroll1758900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "pay_frequency" AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY')`,
    );
    await q.query(
      `CREATE TYPE "payroll_run_status" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID')`,
    );

    await q.query(`
      CREATE TABLE "salary_structures" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        "employee_id"        uuid NOT NULL,
        "effective_from"     date NOT NULL,
        "effective_to"       date,
        "currency"           char(3) NOT NULL,
        "pay_frequency"      "pay_frequency" NOT NULL DEFAULT 'MONTHLY',
        "base_amount"        numeric(14,2) NOT NULL,
        "lines"              jsonb NOT NULL DEFAULT '[]',
        "notes"              varchar(1000),
        "created_by_user_id" uuid,
        CONSTRAINT "PK_1800f745fd1ebe08981cd422acd" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e77e23919f090442d593192aeb8" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_salary_structures_employee_effective" ON "salary_structures" ("employee_id", "effective_from")`,
    );

    await q.query(`
      CREATE TABLE "payroll_runs" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now(),
        "period_start"        date NOT NULL,
        "period_end"          date NOT NULL,
        "pay_date"            date NOT NULL,
        "status"              "payroll_run_status" NOT NULL DEFAULT 'DRAFT',
        "department_id"       uuid,
        "currency"            char(3) NOT NULL,
        "totals"              jsonb NOT NULL DEFAULT '{}',
        "notes"               varchar(1000),
        "created_by_user_id"  uuid,
        "approved_by_user_id" uuid,
        "approved_at"         timestamptz,
        "paid_at"             timestamptz,
        CONSTRAINT "PK_6049f42c972640c0eb99ba8035e" PRIMARY KEY ("id"),
        CONSTRAINT "FK_79b4973ddec9e91526c0ad42045" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_payroll_runs_status" ON "payroll_runs" ("status")`,
    );

    await q.query(`
      CREATE TABLE "payslips" (
        "id"               uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        "run_id"           uuid NOT NULL,
        "employee_id"      uuid NOT NULL,
        "structure_id"     uuid,
        "currency"         char(3) NOT NULL,
        "base_amount"      numeric(14,2) NOT NULL,
        "gross"            numeric(14,2) NOT NULL,
        "total_deductions" numeric(14,2) NOT NULL,
        "net"              numeric(14,2) NOT NULL,
        "lines"            jsonb NOT NULL DEFAULT '[]',
        "document_id"      uuid,
        CONSTRAINT "PK_2b1cd07059daf60cc440c9976e1" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ec67d7b4e9735da6ce837b4b73a" FOREIGN KEY ("run_id")
          REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_3ca6cde51127cd649278d038ca9" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_2bcd3b103d6f58235854edafc32" FOREIGN KEY ("structure_id")
          REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_3f205977a1ed3361f3b15bb473a" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_payslips_run_employee" ON "payslips" ("run_id", "employee_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_payslips_employee_id" ON "payslips" ("employee_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "payslips"`);
    await q.query(`DROP TABLE "payroll_runs"`);
    await q.query(`DROP TABLE "salary_structures"`);
    await q.query(`DROP TYPE "payroll_run_status"`);
    await q.query(`DROP TYPE "pay_frequency"`);
  }
}
