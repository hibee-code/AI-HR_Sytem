# AI HR System — Backend

Production-grade HR management backend with AI-assisted features (policy Q&A over company
documents, resume screening), built on NestJS + PostgreSQL/pgvector + Redis/BullMQ.

## Stack

| Concern         | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Framework       | NestJS 12 (TypeScript 6, CommonJS)                      |
| Database        | PostgreSQL 16 + `pgvector`, TypeORM 1.x (migrations only) |
| Cache / queues  | Redis 7, BullMQ                                          |
| File storage    | Cloudinary                                               |
| Notifications   | Slack bot + SMTP email (queue-driven)                    |
| AI              | LangChain + Hugging Face (embeddings, inference), RAG    |
| Auth            | JWT access + rotating refresh tokens, permission-based RBAC |
| Docs            | Swagger at `/api/docs` (non-production)                  |
| Logging         | pino (JSON in prod, pretty in dev), `X-Correlation-Id`   |
| Tests           | Jest (unit) + Jest/supertest (e2e)                       |

## Quick start

Prerequisites: Node ≥ 20.19, Docker + Compose.

```bash
cp .env.example .env            # then edit secrets (see comments in the file)
docker compose --profile dev up -d postgres redis mailpit
npm install
npm run migration:run
npm run seed                    # dev data (roles, admin user, ...)
npm run start:dev
```

- API: <http://localhost:3000/api/v1>
- Swagger: <http://localhost:3000/api/docs>
- Health: `/health/live`, `/health/ready`
- Mailpit (caught emails): <http://localhost:8025>

Run everything in containers instead (app image included):

```bash
docker compose --profile full up --build
```

## Scripts

| Script                       | What it does                                              |
| ---------------------------- | --------------------------------------------------------- |
| `npm run start:dev`          | Watch mode                                                |
| `npm run build` / `start:prod` | Compile to `dist/` and run                              |
| `npm test` / `test:cov`      | Unit tests                                                |
| `npm run test:e2e`           | e2e tests (needs Postgres + Redis from compose)           |
| `npm run migration:generate -- src/database/migrations/Name` | Diff entities → new migration |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back / list    |
| `npm run migration:run:prod` | Same, against compiled `dist/` (used by the container)    |
| `npm run seed`               | Idempotent dev seeders (refuses in production)            |
| `npm run seed:catalogue`     | Sync roles/permissions only — safe for production, run after deploy |
| `npm run lint` / `format`    | oxlint / prettier                                         |

> Tests run Jest with `--experimental-vm-modules` because NestJS 12 ships as ESM and is
> `require()`d from CommonJS test code (Node ≥ 24.9 handles this natively).

## Project layout

```
src/
├── main.ts                 bootstrap: helmet, CORS, validation, swagger, versioning
├── app.module.ts           wires infrastructure + feature modules
├── config/                 @nestjs/config + Zod env schema (fails fast on bad env)
├── common/                 filters, guards, decorators, base entities, shared DTOs
├── database/               TypeORM options, CLI data-source, migrations/, seeds/
├── infrastructure/         adapters with no HTTP surface: logger, redis, queue, storage, mail, slack
└── modules/                one folder per domain (auth, rbac, employees, leave, ai/…)
```

Conventions:

- **Migrations only.** `synchronize` is hard-coded off. Generate a migration for every entity change.
- **Permissions, not roles, guard routes.** Roles are seeded bundles of `resource:action` permissions.
- **Guards are global**; opt out per-route with `@Public()`.
- **Every response error** has the same envelope (`statusCode`, `error`, `message`, `path`, `timestamp`, `correlationId`).
- **Env is the only config source.** Add new variables to `src/config/env.schema.ts` *and* `.env.example`.

## Authentication & authorisation

- **Invite-only.** `POST /auth/invite` (needs `user:invite`) creates an `INVITED` user and emits
  `auth.user.invited` with a one-time token (7-day TTL). The notifications module (stage 3) will
  email it; until then the dev listener prints the link to the log. `POST /auth/accept-invite`
  sets the password and returns a session.
- **Sessions.** `POST /auth/login` → `{ accessToken (15 m JWT), refreshToken (7 d, opaque) }`.
  `POST /auth/refresh` rotates: the old refresh token is revoked and a successor is issued in the
  same *family*. Presenting a revoked token again is treated as theft and revokes the whole family.
- **Kill switches.** Suspending a user, changing roles, or changing a password invalidates the
  Redis-cached auth context, so the change bites on the very next request; a password change also
  rejects every access token issued before it (`iat` check) and revokes all refresh tokens.
- **Guards** run globally in order *throttle → JWT → permissions*. Routes opt out with
  `@Public()`; routes declare what they need with `@RequirePermissions(PERMISSIONS.X)`.
  Roles are seeded bundles of permissions (`src/modules/rbac/permissions.catalogue.ts`);
  custom roles can be created via `POST /roles`.
- **Secrets at rest.** Passwords: argon2id. Refresh / one-time tokens: SHA-256 hashes only.

Seeded roles: `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`, `RECRUITER`.
Bootstrap admin comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (`npm run seed`).

## Employees & organisation

- **Departments** form a tree (`parent_id`); `GET /departments/tree` returns it with heads and
  headcounts. **Positions** are job titles, optionally scoped to a department.
- **Employees** are HR records, linked 0..1 to a login. `POST /employees` can create and invite the
  login in the same call (`inviteLogin: { roles }`). Employee numbers are `EMP-0001…` from a
  sequence. Every hire, promotion, transfer, manager change, status change and termination writes
  an append-only `employment_history` row.
- **Org chart**: `GET /employees/org-chart` follows `manager_id`. Reporting cycles are rejected.
- **Termination** (`POST /employees/:id/terminate`) moves direct reports up to the leaver's
  manager, clears any department headship, suspends the login and revokes its sessions.
- **Visibility**: `employee:read` (HR) → full records for everyone. Otherwise a caller sees their
  own full record and full records of anyone in their reporting chain; everyone else appears in
  the directory view (`employee:read_directory`), which omits personal fields (phone, personal
  email, date of birth, address, emergency contact, login id).
- Salary is deliberately **not** on the employee record; it arrives with payroll (stage 8).

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there and validated at boot.

## Build stages

| # | Stage                                   | Status |
| - | --------------------------------------- | ------ |
| 0 | Scaffold, config, logging, DB, health   | ✅     |
| 1 | Auth, users, RBAC                       | ✅     |
| 2 | Employees, departments, positions       | ✅     |
| 3 | Queues + notifications (Slack, email)   |        |
| 4 | Onboarding / offboarding                |        |
| 5 | Leave & attendance                      |        |
| 6 | Documents (Cloudinary)                  |        |
| 7 | Performance reviews                     |        |
| 8 | Payroll (stub)                          |        |
| 9 | AI knowledge base + RAG assistant       |        |
| 10| AI resume screening                     |        |
