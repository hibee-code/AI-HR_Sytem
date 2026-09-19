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
- Bull Board (queues, dev only, unauthenticated): <http://localhost:3000/admin/queues>

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

## Notifications

- Modules never talk to SMTP or Slack directly. They emit domain events (`auth.*`, `employee.*`);
  listeners in `src/modules/notifications/listeners/` turn those into `NotificationsService.notify()`
  calls, which write a `notification_log` row per channel and enqueue a BullMQ job (5 attempts,
  exponential backoff). `NotificationsProcessor` delivers and updates the row
  (`QUEUED → SENT | FAILED | SKIPPED`).
- **Templates** live in `src/modules/notifications/templates/index.ts` as typed render functions
  (email subject/text/html + Slack text). Adding a template = adding an entry there.
- **Recipients** are a `userId` (email from the account, Slack id from preferences — resolved
  once by email via `users.lookupByEmail` and cached), a raw `email`, or a `slackChannel`.
- **Preferences**: `GET|PUT /notifications/preferences/me` (`emailEnabled`, `slackEnabled`,
  `slackUserId`). Security emails (password changed) bypass preferences.
- **Idempotency**: pass a `dedupeKey`; a repeat is ignored at the log's unique index.
  Log payloads never contain links or tokens (keys ending in `url`/`token` are redacted).
- **Workers** run in-process. `WORKERS_ENABLED=false` makes an instance enqueue-only.
  Slack needs a bot token with `chat:write`, `im:write`, `users:read.email`; without
  `SLACK_BOT_TOKEN` Slack deliveries are logged as `SKIPPED`.
- `POST /notifications/test` sends a test email + DM to yourself; `GET /notifications/log`
  lists deliveries (HR/Admin).

## Onboarding & offboarding

- **Templates** (`/checklist-templates`, HR) hold ordered items with an *assignee rule*
  (`EMPLOYEE`, `MANAGER`, `HR`, or any `ROLE` name), a due offset in days from the anchor date, and
  a required flag. A department-specific active template beats the company-wide one.
- **Checklists** start automatically: `employee.created` (status `ONBOARDING`) → onboarding
  checklist anchored on the hire date; `employee.terminated` → offboarding anchored on the last
  day. Tasks are copied from the template with assignees resolved to concrete logins where
  possible; HR/role tasks stay role-addressed and appear in every holder's `GET /checklists/tasks/me`.
- **Task updates** (`PATCH /checklists/tasks/:id`) are allowed for the assignee, holders of the
  task's role, or `onboarding:manage`. When every *required* task is `DONE`/`SKIPPED` the checklist
  completes and, for onboarding, the employee is moved `ONBOARDING → ACTIVE` automatically
  (HR can still flip status manually via the employees API).
- **Reminders**: a BullMQ job scheduler (`REMINDERS_CRON`, default 08:00 UTC) sends each assignee one
  digest of tasks due tomorrow or overdue, at most once per task per day.
  `POST /checklists/reminders/run` triggers it on demand.
- Tasks carry an optional `documentId` for the documents module (stage 6).

## Leave & attendance

- **Policy** (`leave:manage_policy`): leave types (`/leave/types`) carry the yearly entitlement,
  paid/unpaid, whether a balance is tracked, carry-over cap + expiry (`MM-DD`), and half-day
  permission. Public holidays (`/leave/holidays`) are excluded from day counts, as are weekends.
  Seeded: Annual 20 (carry 5 → 31 Mar), Sick 10, Unpaid (unlimited), Maternity 90, Paternity 10,
  Compassionate 5.
- **Balances** are per employee × type × year and provisioned lazily: full entitlement, pro-rated by
  remaining months in the hire year, plus capped carry-over from the previous year's row.
  `available = entitled + carriedOver (until expiry) + adjustment − used − pending`.
  HR corrections go through `POST /leave/balances/adjust` and are audited.
- **Requests**: employees submit (`POST /leave/requests`); days are reserved as *pending*. The
  direct manager's login is the approver; anyone higher in the reporting chain or HR
  (`leave:read_all`) may decide too; nobody decides their own. Approve moves pending → used;
  reject/cancel release. Employees may cancel approved leave only before it starts.
  Requests can't overlap, span calendar years, or contain zero working days.
- **Status coupling**: approved leave of ≥ 30 calendar days flips the employee to `ON_LEAVE`
  (immediately if already started, else by the 00:05 UTC daily job) and back to `ACTIVE` the day
  after it ends.
- **Attendance**: `POST /attendance/clock-in|clock-out` (one open session at a time),
  `GET /attendance/me` (sessions + daily totals), HR manual records/corrections, and a monthly
  report (`GET /attendance/report?month=YYYY-MM`) with days present, minutes, approved leave days.
  Sessions left open > 16 h are auto-closed at 16 h by an hourly job and flagged.

## Documents

- **Storage** sits behind a port (`src/infrastructure/storage/storage.interface.ts`). `STORAGE_DRIVER=cloudinary`
  uploads private assets (`type: private`) and serves them only through short-lived signed download
  links (`DOWNLOAD_URL_TTL_SECONDS`); `STORAGE_DRIVER=memory` is for tests/local dev and persists nothing.
- **Model**: a `document` (owner employee or company-level, category, visibility) has one or more
  `document_versions` (provider key, MIME, bytes, SHA-256); `current_version_id` is what downloads
  serve by default. Delete is soft; versions and files are retained.
- **Visibility**: `PRIVATE` = owner + reporting chain + HR; `RESTRICTED` = owner + HR (payslips, ID);
  `COMPANY` = every employee (HR-only to publish). `CONTRACT` and `PAYSLIP` are HR-issued; employees
  can't create or replace them. Only the uploader or HR may add versions / edit / delete.
- **Uploads** are `multipart/form-data` with a `file` field: `POST /documents` (+ `title`, `category`,
  `visibility?`, `ownerEmployeeId?`), `POST /documents/:id/versions`, `PUT /documents/profile-photo/me`
  (public image → `employees.photo_url`). Allowed types: PDF, Word, Excel, text/CSV/Markdown,
  PNG/JPEG/WebP; size ≤ `MAX_UPLOAD_MB`. Downloads: `GET /documents/:id/download[?version=n]` → `{ url, expiresAt }`.
- `POLICY` documents with `COMPANY` visibility are what the knowledge base (stage 9) ingests;
  `kb_indexed_at` tracks that and resets whenever the content or visibility changes.
- `checklist_tasks.document_id` and `leave_requests.attachment_document_id` are now real FKs.

## Performance reviews

- **Cycles** (`review:manage_cycles`): period, deadlines, optional department scope, a rating scale
  (default 1–5 with labels, editable per cycle until launch) and a competency list. Phases move
  forward only: `DRAFT → SELF_REVIEW → MANAGER_REVIEW → CALIBRATION → CLOSED`
  (`POST /performance/cycles/:id/launch`, then `/advance`).
- **Launch** creates one review per non-terminated employee in scope, with the manager's login as
  reviewer (HR can reassign). Employees write their self-assessment (`PUT /reviews/:id/self`),
  reviewers — the designated manager, anyone above in the chain, or HR — write theirs
  (`PUT /reviews/:id/manager`), HR calibrates the final rating during `CALIBRATION`, and closing
  defaults any uncalibrated final rating to the manager rating and asks employees to acknowledge.
- **Visibility**: employees never see the manager assessment or rating until the cycle is closed
  and never see calibration notes; peer feedback reaches them anonymised after close. Reviewers see
  feedback with names but not calibration notes; HR sees everything.
- **Peer feedback**: the employee, reviewer or HR requests it from any logins; givers answer via
  `PUT /performance/feedback/:id` (or decline). One request per giver per review.
- **Goals**: employees propose (`DRAFT`), managers/HR approve or create directly (`ACTIVE`);
  active + draft weights per employee are capped at 100 %. Owners update progress; re-scoping an
  approved goal is the manager's job.
- **Reminders**: a daily job (08:30 UTC) nudges pending self-reviews and reviewers within 2 days of
  their deadline or overdue. `GET /performance/cycles/:id/report` gives per-department completion and
  rating distribution.

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there and validated at boot.

## Build stages

| # | Stage                                   | Status |
| - | --------------------------------------- | ------ |
| 0 | Scaffold, config, logging, DB, health   | ✅     |
| 1 | Auth, users, RBAC                       | ✅     |
| 2 | Employees, departments, positions       | ✅     |
| 3 | Queues + notifications (Slack, email)   | ✅     |
| 4 | Onboarding / offboarding                | ✅     |
| 5 | Leave & attendance                      | ✅     |
| 6 | Documents (Cloudinary)                  | ✅     |
| 7 | Performance reviews                     | ✅     |
| 8 | Payroll (stub)                          |        |
| 9 | AI knowledge base + RAG assistant       |        |
| 10| AI resume screening                     |        |
