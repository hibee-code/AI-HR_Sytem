import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 7: review cycles, reviews, peer feedback, goals. */
export class Performance1758800000000 implements MigrationInterface {
  name = 'Performance1758800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "cycle_phase" AS ENUM ('DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED')`,
    );
    await q.query(
      `CREATE TYPE "goal_status" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')`,
    );
    await q.query(
      `CREATE TYPE "review_status" AS ENUM ('PENDING_SELF', 'PENDING_MANAGER', 'PENDING_CALIBRATION', 'COMPLETED', 'ACKNOWLEDGED')`,
    );
    await q.query(
      `CREATE TYPE "feedback_status" AS ENUM ('REQUESTED', 'SUBMITTED', 'DECLINED')`,
    );

    await q.query(`
      CREATE TABLE "review_cycles" (
        "id"                      uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"              timestamptz NOT NULL DEFAULT now(),
        "updated_at"              timestamptz NOT NULL DEFAULT now(),
        "name"                    varchar(100) NOT NULL,
        "description"             varchar(1000),
        "period_start"            date NOT NULL,
        "period_end"              date NOT NULL,
        "phase"                   "cycle_phase" NOT NULL DEFAULT 'DRAFT',
        "self_review_deadline"    date NOT NULL,
        "manager_review_deadline" date NOT NULL,
        "department_id"           uuid,
        "rating_scale"            jsonb NOT NULL DEFAULT '[{"value":1,"label":"Needs improvement"},{"value":2,"label":"Developing"},{"value":3,"label":"Meets expectations"},{"value":4,"label":"Exceeds expectations"},{"value":5,"label":"Exceptional"}]',
        "competencies"            jsonb NOT NULL DEFAULT '[]',
        "launched_at"             timestamptz,
        "closed_at"               timestamptz,
        "created_by_user_id"      uuid,
        CONSTRAINT "PK_5634972955eaa909a8ff55736a7" PRIMARY KEY ("id"),
        CONSTRAINT "FK_96ecddb55d5506188eb96ce7c81" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_review_cycles_phase" ON "review_cycles" ("phase")`,
    );

    await q.query(`
      CREATE TABLE "goals" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now(),
        "employee_id"         uuid NOT NULL,
        "cycle_id"            uuid,
        "title"               varchar(200) NOT NULL,
        "description"         varchar(2000),
        "weight"              integer NOT NULL DEFAULT 0,
        "status"              "goal_status" NOT NULL DEFAULT 'DRAFT',
        "progress"            integer NOT NULL DEFAULT 0,
        "due_date"            date,
        "approved_by_user_id" uuid,
        "approved_at"         timestamptz,
        "created_by_user_id"  uuid,
        CONSTRAINT "PK_26e17b251afab35580dff769223" PRIMARY KEY ("id"),
        CONSTRAINT "FK_8ff416fb969445fa3e470654c8a" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_996ec931c7b35b57a45b621e74e" FOREIGN KEY ("cycle_id")
          REFERENCES "review_cycles"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_goals_employee_id" ON "goals" ("employee_id")`,
    );
    await q.query(`CREATE INDEX "idx_goals_cycle_id" ON "goals" ("cycle_id")`);

    await q.query(`
      CREATE TABLE "reviews" (
        "id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        "updated_at"           timestamptz NOT NULL DEFAULT now(),
        "cycle_id"             uuid NOT NULL,
        "employee_id"          uuid NOT NULL,
        "reviewer_user_id"     uuid,
        "status"               "review_status" NOT NULL DEFAULT 'PENDING_SELF',
        "self_assessment"      jsonb,
        "self_rating"          smallint,
        "self_submitted_at"    timestamptz,
        "manager_assessment"   jsonb,
        "manager_rating"       smallint,
        "manager_submitted_at" timestamptz,
        "final_rating"         smallint,
        "calibrated"           boolean NOT NULL DEFAULT false,
        "calibration_note"     varchar(1000),
        "acknowledged_at"      timestamptz,
        "employee_comment"     varchar(2000),
        CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"),
        CONSTRAINT "FK_9022a5595fab9adf58ac8e144c5" FOREIGN KEY ("cycle_id")
          REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_c757a01d5b7a356b72238ad6c1c" FOREIGN KEY ("employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_a012538eb1c025bb46222968b90" FOREIGN KEY ("reviewer_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_reviews_cycle_employee" ON "reviews" ("cycle_id", "employee_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_reviews_employee_id" ON "reviews" ("employee_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_reviews_reviewer_user_id" ON "reviews" ("reviewer_user_id")`,
    );

    await q.query(`
      CREATE TABLE "review_feedback" (
        "id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        "updated_at"           timestamptz NOT NULL DEFAULT now(),
        "review_id"            uuid NOT NULL,
        "requested_by_user_id" uuid,
        "giver_user_id"        uuid NOT NULL,
        "status"               "feedback_status" NOT NULL DEFAULT 'REQUESTED',
        "answers"              jsonb,
        "submitted_at"         timestamptz,
        CONSTRAINT "PK_90f88861e3de37f1b8e6615434f" PRIMARY KEY ("id"),
        CONSTRAINT "FK_e63d9dfb692caf40e5380a8d505" FOREIGN KEY ("review_id")
          REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_97b7d48c6ad2704e5415d8d1c0f" FOREIGN KEY ("giver_user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_review_feedback_review_giver" ON "review_feedback" ("review_id", "giver_user_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_review_feedback_giver_user_id" ON "review_feedback" ("giver_user_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "review_feedback"`);
    await q.query(`DROP TABLE "reviews"`);
    await q.query(`DROP TABLE "goals"`);
    await q.query(`DROP TABLE "review_cycles"`);
    await q.query(`DROP TYPE "feedback_status"`);
    await q.query(`DROP TYPE "review_status"`);
    await q.query(`DROP TYPE "goal_status"`);
    await q.query(`DROP TYPE "cycle_phase"`);
  }
}
