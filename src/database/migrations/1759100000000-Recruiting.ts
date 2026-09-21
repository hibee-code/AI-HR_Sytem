import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 10: job openings, candidates, applications with AI screening; RESUME document category. */
export class Recruiting1759100000000 implements MigrationInterface {
  name = 'Recruiting1759100000000';

  public async up(q: QueryRunner): Promise<void> {
    // PG ≥ 12 allows ADD VALUE inside a transaction as long as the new value
    // isn't used in the same transaction (it isn't).
    await q.query(
      `ALTER TYPE "document_category" ADD VALUE IF NOT EXISTS 'RESUME'`,
    );

    await q.query(
      `CREATE TYPE "opening_status" AS ENUM ('DRAFT', 'OPEN', 'CLOSED')`,
    );
    await q.query(
      `CREATE TYPE "application_status" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN')`,
    );
    await q.query(
      `CREATE TYPE "screening_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED')`,
    );

    await q.query(`
      CREATE TABLE "job_openings" (
        "id"            uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        "title"         varchar(150) NOT NULL,
        "department_id" uuid NOT NULL,
        "position_id"   uuid,
        "description"   text NOT NULL,
        "requirements"  jsonb NOT NULL DEFAULT '[]',
        "status"        "opening_status" NOT NULL DEFAULT 'DRAFT',
        "owner_user_id" uuid,
        "closed_at"     timestamptz,
        CONSTRAINT "PK_6888a7e6783262ac38387fc3e8d" PRIMARY KEY ("id"),
        CONSTRAINT "FK_00c11151abb20deb8aea0b14f43" FOREIGN KEY ("department_id")
          REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_fccb63f3479b22684a9b9a5177b" FOREIGN KEY ("position_id")
          REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_b4708c73b78263f949e0398be9e" FOREIGN KEY ("owner_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_job_openings_status" ON "job_openings" ("status")`,
    );

    await q.query(`
      CREATE TABLE "candidates" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "first_name" varchar(100) NOT NULL,
        "last_name"  varchar(100) NOT NULL,
        "email"      citext NOT NULL,
        "phone"      varchar(30),
        "source"     varchar(100),
        CONSTRAINT "PK_140681296bf033ab1eb95288abb" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_candidates_email" ON "candidates" ("email")`,
    );

    await q.query(`
      CREATE TABLE "applications" (
        "id"                        uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"                timestamptz NOT NULL DEFAULT now(),
        "updated_at"                timestamptz NOT NULL DEFAULT now(),
        "opening_id"                uuid NOT NULL,
        "candidate_id"              uuid NOT NULL,
        "resume_document_id"        uuid NOT NULL,
        "status"                    "application_status" NOT NULL DEFAULT 'APPLIED',
        "screening_status"          "screening_status" NOT NULL DEFAULT 'PENDING',
        "screening"                 jsonb,
        "fit_score"                 smallint,
        "screening_error"           varchar(500),
        "cover_letter"              text,
        "notes"                     text,
        "status_changed_by_user_id" uuid,
        CONSTRAINT "PK_938c0a27255637bde919591888f" PRIMARY KEY ("id"),
        CONSTRAINT "FK_2691d59a636ccc8b17a3be8469c" FOREIGN KEY ("opening_id")
          REFERENCES "job_openings"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_b669b991b85b808f24b5734990a" FOREIGN KEY ("candidate_id")
          REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_2adc78ee723510f81631960d514" FOREIGN KEY ("resume_document_id")
          REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_applications_opening_candidate" ON "applications" ("opening_id", "candidate_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_applications_candidate_id" ON "applications" ("candidate_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_applications_status" ON "applications" ("status")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "applications"`);
    await q.query(`DROP TABLE "candidates"`);
    await q.query(`DROP TABLE "job_openings"`);
    await q.query(`DROP TYPE "screening_status"`);
    await q.query(`DROP TYPE "application_status"`);
    await q.query(`DROP TYPE "opening_status"`);
    // Postgres cannot drop a single enum value; 'RESUME' stays on document_category.
  }
}
