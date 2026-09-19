import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 5: leave policy, balances, requests, public holidays, attendance. */
export class LeaveAndAttendance1758600000000 implements MigrationInterface {
  name = 'LeaveAndAttendance1758600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE "half_day" AS ENUM ('NONE', 'AM', 'PM')`);
    await q.query(
      `CREATE TYPE "leave_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')`,
    );
    await q.query(
      `CREATE TYPE "attendance_source" AS ENUM ('CLOCK', 'MANUAL')`,
    );

    await q.query(`
      CREATE TABLE "leave_types" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now(),
        "code"                  varchar(30) NOT NULL,
        "name"                  varchar(100) NOT NULL,
        "description"           varchar(500),
        "default_days"          numeric(5,1) NOT NULL DEFAULT 0,
        "is_paid"               boolean NOT NULL DEFAULT true,
        "requires_balance"      boolean NOT NULL DEFAULT true,
        "carry_over_max_days"   numeric(5,1) NOT NULL DEFAULT 0,
        "carry_over_expires_on" varchar(5),
        "allow_half_day"        boolean NOT NULL DEFAULT true,
        "is_active"             boolean NOT NULL DEFAULT true,
        "sort_order"            integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_359223e0755d19711813cd07394" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_leave_types_code" ON "leave_types" ("code")`,
    );

    await q.query(`
      CREATE TABLE "public_holidays" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "date"       date NOT NULL,
        "name"       varchar(100) NOT NULL,
        CONSTRAINT "PK_e959831bb7c79c39cc58207c122" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_public_holidays_date" ON "public_holidays" ("date")`,
    );

    await q.query(`
      CREATE TABLE "leave_balances" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now(),
        "employee_id"           uuid NOT NULL,
        "leave_type_id"         uuid NOT NULL,
        "year"                  integer NOT NULL,
        "entitled"              numeric(5,1) NOT NULL DEFAULT 0,
        "carried_over"          numeric(5,1) NOT NULL DEFAULT 0,
        "carry_over_expires_on" date,
        "adjustment"            numeric(5,1) NOT NULL DEFAULT 0,
        "used"                  numeric(5,1) NOT NULL DEFAULT 0,
        "pending"               numeric(5,1) NOT NULL DEFAULT 0,
        CONSTRAINT "PK_a1d90dff48fb2bfd23a7163d077" PRIMARY KEY ("id"),
        CONSTRAINT "FK_2f8aebce74941a2e2168e94ba68" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_d64da0a991d2f4d23d86031530c" FOREIGN KEY ("leave_type_id")
          REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_leave_balances_employee_type_year" ON "leave_balances" ("employee_id", "leave_type_id", "year")`,
    );

    await q.query(`
      CREATE TABLE "leave_balance_adjustments" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "balance_id" uuid NOT NULL,
        "delta"      numeric(5,1) NOT NULL,
        "reason"     varchar(500) NOT NULL,
        "by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_739992a2c808e6d364d9f2741a1" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e901c7287abf81464e90e413ff3" FOREIGN KEY ("balance_id")
          REFERENCES "leave_balances"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_leave_balance_adjustments_balance_id" ON "leave_balance_adjustments" ("balance_id")`,
    );

    await q.query(`
      CREATE TABLE "leave_requests" (
        "id"                     uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        "employee_id"            uuid NOT NULL,
        "leave_type_id"          uuid NOT NULL,
        "start_date"             date NOT NULL,
        "end_date"               date NOT NULL,
        "half_day"               "half_day" NOT NULL DEFAULT 'NONE',
        "days"                   numeric(5,1) NOT NULL,
        "year"                   integer NOT NULL,
        "reason"                 varchar(1000),
        "status"                 "leave_request_status" NOT NULL DEFAULT 'PENDING',
        "approver_user_id"       uuid,
        "decided_by_user_id"     uuid,
        "decided_at"             timestamptz,
        "decision_note"          varchar(1000),
        "attachment_document_id" uuid,
        "status_applied"         boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_d3abcf9a16cef1450129e06fa9f" PRIMARY KEY ("id"),
        CONSTRAINT "FK_52b4b7c7d295e204add6dbe0a09" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_54a57db316598806786c2b95323" FOREIGN KEY ("leave_type_id")
          REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_95918ab917c787dc50bc1942b36" FOREIGN KEY ("approver_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_leave_requests_employee_dates" ON "leave_requests" ("employee_id", "start_date", "end_date")`,
    );
    await q.query(
      `CREATE INDEX "idx_leave_requests_status" ON "leave_requests" ("status")`,
    );
    await q.query(
      `CREATE INDEX "idx_leave_requests_approver_user_id" ON "leave_requests" ("approver_user_id")`,
    );

    await q.query(`
      CREATE TABLE "attendance_records" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        "employee_id"        uuid NOT NULL,
        "date"               date NOT NULL,
        "clock_in"           timestamptz NOT NULL,
        "clock_out"          timestamptz,
        "worked_minutes"     integer,
        "source"             "attendance_source" NOT NULL DEFAULT 'CLOCK',
        "auto_closed"        boolean NOT NULL DEFAULT false,
        "note"               varchar(500),
        "created_by_user_id" uuid,
        CONSTRAINT "PK_946920332f5bc9efad3f3023b96" PRIMARY KEY ("id"),
        CONSTRAINT "FK_f97d7be854091ef9ab5d75c0de3" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_attendance_records_employee_date" ON "attendance_records" ("employee_id", "date")`,
    );
    await q.query(
      `CREATE INDEX "idx_attendance_records_open" ON "attendance_records" ("clock_out") WHERE "clock_out" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "attendance_records"`);
    await q.query(`DROP TABLE "leave_requests"`);
    await q.query(`DROP TABLE "leave_balance_adjustments"`);
    await q.query(`DROP TABLE "leave_balances"`);
    await q.query(`DROP TABLE "public_holidays"`);
    await q.query(`DROP TABLE "leave_types"`);
    await q.query(`DROP TYPE "attendance_source"`);
    await q.query(`DROP TYPE "leave_request_status"`);
    await q.query(`DROP TYPE "half_day"`);
  }
}
