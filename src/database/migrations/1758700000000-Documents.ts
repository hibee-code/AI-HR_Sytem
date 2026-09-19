import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 6: documents + versions, and FKs from checklist tasks / leave requests. */
export class Documents1758700000000 implements MigrationInterface {
  name = 'Documents1758700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "document_category" AS ENUM ('CONTRACT', 'ID', 'CERTIFICATE', 'PAYSLIP', 'POLICY', 'OTHER')`,
    );
    await q.query(
      `CREATE TYPE "document_visibility" AS ENUM ('PRIVATE', 'RESTRICTED', 'COMPANY')`,
    );

    // current_version FK is added after document_versions exists (circular).
    await q.query(`
      CREATE TABLE "documents" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        "owner_employee_id"   uuid,
        "title"               varchar(200) NOT NULL,
        "description"         varchar(1000),
        "category"            "document_category" NOT NULL,
        "visibility"          "document_visibility" NOT NULL DEFAULT 'PRIVATE',
        "current_version_id"  uuid,
        "uploaded_by_user_id" uuid,
        "kb_indexed_at"       timestamptz,
        CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"),
        CONSTRAINT "REL_a1f222cacfdd65e4b28e7b3c9f" UNIQUE ("current_version_id"),
        CONSTRAINT "FK_9a77bd626b225e3d3644e307c6a" FOREIGN KEY ("owner_employee_id")
          REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_documents_owner_employee_id" ON "documents" ("owner_employee_id")`,
    );
    await q.query(
      `CREATE INDEX "idx_documents_category" ON "documents" ("category")`,
    );

    await q.query(`
      CREATE TABLE "document_versions" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "document_id"         uuid NOT NULL,
        "version"             integer NOT NULL,
        "storage_key"         varchar(500) NOT NULL,
        "resource_type"       varchar(10) NOT NULL,
        "original_filename"   varchar(255) NOT NULL,
        "mime_type"           varchar(100) NOT NULL,
        "bytes"               integer NOT NULL,
        "checksum"            char(64) NOT NULL,
        "uploaded_by_user_id" uuid,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_baf26dab035c6d6fc433f9dc6a2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ac75577bca976d6d581b0f459b6" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_document_versions_document_version" ON "document_versions" ("document_id", "version")`,
    );

    await q.query(`
      ALTER TABLE "documents"
        ADD CONSTRAINT "FK_a1f222cacfdd65e4b28e7b3c9f6" FOREIGN KEY ("current_version_id")
          REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

    // Earlier stages left these as plain uuid columns.
    await q.query(`
      ALTER TABLE "checklist_tasks"
        ADD CONSTRAINT "FK_c52f4c95445138d4e991d37ae08" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await q.query(`
      ALTER TABLE "leave_requests"
        ADD CONSTRAINT "FK_95dd7f2dd3c789c80e9eaf08ae1" FOREIGN KEY ("attachment_document_id")
          REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "leave_requests" DROP CONSTRAINT "FK_95dd7f2dd3c789c80e9eaf08ae1"`,
    );
    await q.query(
      `ALTER TABLE "checklist_tasks" DROP CONSTRAINT "FK_c52f4c95445138d4e991d37ae08"`,
    );
    await q.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_a1f222cacfdd65e4b28e7b3c9f6"`,
    );
    await q.query(`DROP TABLE "document_versions"`);
    await q.query(`DROP TABLE "documents"`);
    await q.query(`DROP TYPE "document_visibility"`);
    await q.query(`DROP TYPE "document_category"`);
  }
}
