import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 4: checklist templates/items and per-employee checklists/tasks. */
export class Onboarding1758500000000 implements MigrationInterface {
  name = 'Onboarding1758500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "checklist_type" AS ENUM ('ONBOARDING', 'OFFBOARDING')`,
    );
    await q.query(
      `CREATE TYPE "assignee_rule" AS ENUM ('EMPLOYEE', 'MANAGER', 'HR', 'ROLE')`,
    );
    await q.query(
      `CREATE TYPE "checklist_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')`,
    );
    await q.query(
      `CREATE TYPE "task_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED')`,
    );

    await q.query(`
      CREATE TABLE "checklist_templates" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        "name"          varchar(100) NOT NULL,
        "type"          "checklist_type" NOT NULL,
        "description"   varchar(500),
        "department_id" uuid,
        "is_active"     boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_e6d17651d110bbac45cf07e44fa" PRIMARY KEY ("id"),
        CONSTRAINT "FK_eccb1fcdd657269add4da2c1d0f" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_checklist_templates_type" ON "checklist_templates" ("type")`,
    );

    await q.query(`
      CREATE TABLE "checklist_template_items" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        "template_id"        uuid NOT NULL,
        "title"              varchar(200) NOT NULL,
        "description"        varchar(1000),
        "assignee_rule"      "assignee_rule" NOT NULL,
        "assignee_role_name" varchar(50),
        "due_offset_days"    integer NOT NULL DEFAULT 0,
        "sort_order"         integer NOT NULL DEFAULT 0,
        "is_required"        boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_27f7e6351f6748a0c3053d4b97a" PRIMARY KEY ("id"),
        CONSTRAINT "FK_5de6eeebd7ffec3fdf257ff21be" FOREIGN KEY ("template_id")
          REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_checklist_template_items_template_id" ON "checklist_template_items" ("template_id")`,
    );

    await q.query(`
      CREATE TABLE "checklists" (
        "id"                 uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        "employee_id"        uuid NOT NULL,
        "template_id"        uuid,
        "type"               "checklist_type" NOT NULL,
        "status"             "checklist_status" NOT NULL DEFAULT 'IN_PROGRESS',
        "anchor_date"        date NOT NULL,
        "completed_at"       timestamptz,
        "created_by_user_id" uuid,
        CONSTRAINT "PK_336ade2047f3d713e1afa20d2c6" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e7f6180a4efec57ace47b36f542" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_a89ed08f10facaa532d08266eed" FOREIGN KEY ("template_id")
          REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_checklists_employee_id" ON "checklists" ("employee_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_checklists_status" ON "checklists" ("status")`,
    );

    await q.query(`
      CREATE TABLE "checklist_tasks" (
        "id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        "updated_at"           timestamptz NOT NULL DEFAULT now(),
        "checklist_id"         uuid NOT NULL,
        "template_item_id"     uuid,
        "title"                varchar(200) NOT NULL,
        "description"          varchar(1000),
        "assignee_rule"        "assignee_rule" NOT NULL,
        "assignee_user_id"     uuid,
        "assignee_role_name"   varchar(50),
        "due_date"             date NOT NULL,
        "status"               "task_status" NOT NULL DEFAULT 'PENDING',
        "is_required"          boolean NOT NULL DEFAULT true,
        "sort_order"           integer NOT NULL DEFAULT 0,
        "notes"                varchar(1000),
        "document_id"          uuid,
        "completed_at"         timestamptz,
        "completed_by_user_id" uuid,
        "last_reminded_at"     timestamptz,
        CONSTRAINT "PK_f63da8740c5aea17102761665ae" PRIMARY KEY ("id"),
        CONSTRAINT "FK_733e79230a3c7ccdb0c548885ce" FOREIGN KEY ("checklist_id")
          REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_fac449a9a7092ee4fc7c13167f6" FOREIGN KEY ("assignee_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_checklist_tasks_checklist_id" ON "checklist_tasks" ("checklist_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_checklist_tasks_assignee_user_id" ON "checklist_tasks" ("assignee_user_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_checklist_tasks_due_date" ON "checklist_tasks" ("due_date")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "checklist_tasks"`);
    await q.query(`DROP TABLE "checklists"`);
    await q.query(`DROP TABLE "checklist_template_items"`);
    await q.query(`DROP TABLE "checklist_templates"`);
    await q.query(`DROP TYPE "task_status"`);
    await q.query(`DROP TYPE "checklist_status"`);
    await q.query(`DROP TYPE "assignee_rule"`);
    await q.query(`DROP TYPE "checklist_type"`);
  }
}
