import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 2: departments, positions, employees, employment_history, and the
 * employee-number sequence. Constraint names follow TypeORM's default
 * naming strategy (see stage-1 migration).
 */
export class Employees1758300000000 implements MigrationInterface {
  name = 'Employees1758300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "employee_status" AS ENUM ('ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'TERMINATED')`,
    );
    await q.query(
      `CREATE TYPE "employment_type" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN')`,
    );
    await q.query(
      `CREATE TYPE "employment_change_type" AS ENUM ('HIRE', 'PROMOTION', 'TRANSFER', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'TERMINATION')`,
    );
    // EMP-0001, EMP-0002, ... (formatted in EmployeesService)
    await q.query(
      `CREATE SEQUENCE "employee_number_seq" START WITH 1 INCREMENT BY 1`,
    );

    // ── departments (head FK added after employees exists) ───────────────
    await q.query(`
      CREATE TABLE "departments" (
        "id"               uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now(),
        "name"             varchar(100) NOT NULL,
        "code"             varchar(20) NOT NULL,
        "description"      varchar(500),
        "parent_id"        uuid,
        "head_employee_id" uuid,
        CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id"),
        CONSTRAINT "FK_700b0b13f494cb37b6ca929e79b" FOREIGN KEY ("parent_id")
          REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_departments_code" ON "departments" ("code")`,
    );

    // ── positions ────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "positions" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        "title"         varchar(100) NOT NULL,
        "level"         varchar(50),
        "department_id" uuid,
        "is_active"     boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_17e4e62ccd5749b289ae3fae6f3" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e413c6578fcdae9a8fd673c5bc7" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);

    // ── employees ────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "employees" (
        "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        "deleted_at"        timestamptz,
        "user_id"           uuid,
        "employee_number"   varchar(20) NOT NULL,
        "first_name"        varchar(100) NOT NULL,
        "last_name"         varchar(100) NOT NULL,
        "work_email"        citext NOT NULL,
        "personal_email"    citext,
        "phone"             varchar(30),
        "date_of_birth"     date,
        "address"           jsonb,
        "emergency_contact" jsonb,
        "photo_url"         varchar(500),
        "hire_date"         date NOT NULL,
        "termination_date"  date,
        "status"            "employee_status" NOT NULL DEFAULT 'ONBOARDING',
        "employment_type"   "employment_type" NOT NULL DEFAULT 'FULL_TIME',
        "department_id"     uuid NOT NULL,
        "position_id"       uuid,
        "manager_id"        uuid,
        CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"),
        CONSTRAINT "FK_2d83c53c3e553a48dadb9722e38" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_678a3540f843823784b0fe4a4f2" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_8b14204e8af5e371e36b8c11e1b" FOREIGN KEY ("position_id")
          REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_bcdf921072a19dd2758a628c5c0" FOREIGN KEY ("manager_id")
          REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_employees_user_id" ON "employees" ("user_id") WHERE "user_id" IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_employees_employee_number" ON "employees" ("employee_number")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_employees_work_email" ON "employees" ("work_email")`,
    );
    await q.query(
      `CREATE INDEX "idx_employees_department_id" ON "employees" ("department_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_employees_manager_id" ON "employees" ("manager_id")`,
    );

    await q.query(`
      ALTER TABLE "departments"
        ADD CONSTRAINT "FK_f4a832f1cb3b714ba6ae7c92872" FOREIGN KEY ("head_employee_id")
          REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

    // ── employment_history ───────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "employment_history" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "employee_id"        uuid NOT NULL,
        "change_type"        "employment_change_type" NOT NULL,
        "effective_date"     date NOT NULL,
        "from_department_id" uuid,
        "to_department_id"   uuid,
        "from_position_id"   uuid,
        "to_position_id"     uuid,
        "from_manager_id"    uuid,
        "to_manager_id"      uuid,
        "from_status"        "employee_status",
        "to_status"          "employee_status",
        "notes"              varchar(1000),
        "changed_by_user_id" uuid,
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_27b0c31619fc4a20f21a6d776a6" PRIMARY KEY ("id"),
        CONSTRAINT "FK_b16c5d5bb155f0b25b2253ef214" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_ac6fe0c91d6861c073ba8ae0813" FOREIGN KEY ("from_department_id")
          REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_f0686fefa1dc1177f266b47c64e" FOREIGN KEY ("to_department_id")
          REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_b0ae62d4f192d4646d85ea8c325" FOREIGN KEY ("from_position_id")
          REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_7ac5a5abee0e23796c1e75d9a93" FOREIGN KEY ("to_position_id")
          REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_806ad3c52df8554a63707ef2334" FOREIGN KEY ("from_manager_id")
          REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_066d7dccde712ca6b0ad181bc89" FOREIGN KEY ("to_manager_id")
          REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_employment_history_employee_id" ON "employment_history" ("employee_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "employment_history"`);
    await q.query(
      `ALTER TABLE "departments" DROP CONSTRAINT "FK_f4a832f1cb3b714ba6ae7c92872"`,
    );
    await q.query(`DROP TABLE "employees"`);
    await q.query(`DROP TABLE "positions"`);
    await q.query(`DROP TABLE "departments"`);
    await q.query(`DROP SEQUENCE "employee_number_seq"`);
    await q.query(`DROP TYPE "employment_change_type"`);
    await q.query(`DROP TYPE "employment_type"`);
    await q.query(`DROP TYPE "employee_status"`);
  }
}
