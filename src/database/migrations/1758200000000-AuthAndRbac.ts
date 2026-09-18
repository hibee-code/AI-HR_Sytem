import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1: users, roles, permissions, join tables, refresh + one-time tokens.
 * Constraint names follow TypeORM's DefaultNamingStrategy so that a later
 * `migration:generate` against these entities yields no diff.
 */
export class AuthAndRbac1758200000000 implements MigrationInterface {
  name = 'AuthAndRbac1758200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "user_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED')`,
    );
    await q.query(
      `CREATE TYPE "one_time_token_type" AS ENUM ('INVITE', 'PASSWORD_RESET')`,
    );

    // ── permissions ──────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "permissions" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        "name"        varchar(100) NOT NULL,
        "description" varchar(255),
        CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_48ce552495d14eae9b187bb6716" UNIQUE ("name")
      )`);

    // ── roles ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "roles" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        "name"        varchar(50) NOT NULL,
        "description" varchar(255),
        "is_system"   boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name")
      )`);

    await q.query(`
      CREATE TABLE "role_permissions" (
        "role_id"       uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id")
          REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "role_permissions" ("role_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_17022daf3f885f7d35423e9971" ON "role_permissions" ("permission_id")`,
    );

    // ── users ────────────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "users" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now(),
        "deleted_at"          timestamptz,
        "email"               citext NOT NULL,
        "password_hash"       varchar(255),
        "first_name"          varchar(100) NOT NULL,
        "last_name"           varchar(100) NOT NULL,
        "status"              "user_status" NOT NULL DEFAULT 'INVITED',
        "last_login_at"       timestamptz,
        "password_changed_at" timestamptz,
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);

    await q.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id")
          REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_87b8888186ca9769c960e92687" ON "user_roles" ("user_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_b23c65e50a758245a33ee35fda" ON "user_roles" ("role_id")`,
    );

    // ── refresh_tokens ───────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "refresh_tokens" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid NOT NULL,
        "token_hash"     char(64) NOT NULL,
        "family_id"      uuid NOT NULL,
        "expires_at"     timestamptz NOT NULL,
        "revoked_at"     timestamptz,
        "replaced_by_id" uuid,
        "user_agent"     varchar(512),
        "ip_address"     varchar(64),
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"),
        CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`,
    );
    await q.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );

    // ── one_time_tokens ──────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE "one_time_tokens" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id"    uuid NOT NULL,
        "type"       "one_time_token_type" NOT NULL,
        "token_hash" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at"    timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_8e470cc9ffc1b2afa054304db17" PRIMARY KEY ("id"),
        CONSTRAINT "FK_0dc2deee64e514ad6f7e69504e1" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_one_time_tokens_user_id" ON "one_time_tokens" ("user_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "uq_one_time_tokens_token_hash" ON "one_time_tokens" ("token_hash")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "one_time_tokens"`);
    await q.query(`DROP TABLE "refresh_tokens"`);
    await q.query(`DROP TABLE "user_roles"`);
    await q.query(`DROP TABLE "users"`);
    await q.query(`DROP TABLE "role_permissions"`);
    await q.query(`DROP TABLE "roles"`);
    await q.query(`DROP TABLE "permissions"`);
    await q.query(`DROP TYPE "one_time_token_type"`);
    await q.query(`DROP TYPE "user_status"`);
  }
}
