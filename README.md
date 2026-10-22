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
| AI              | RAG: Hugging Face embeddings + Claude (Haiku 5.5) with HF/OpenAI fallback; SSE streaming |
| Auth            | JWT access + rotating refresh tokens, permission-based RBAC |
| Docs            | Swagger at `/api/docs` (non-production)                  |
| Logging         | pino (JSON in prod, pretty in dev), `X-Correlation-Id`   |
| Tests           | Jest (unit) + Jest/supertest (e2e), GitHub Actions CI    |
| Edge / TLS      | Caddy (automatic Let's Encrypt) in `docker-compose.prod.yml` |

## Quick start

Prerequisites: Node ≥ 20.19, Docker + Compose.

```bash
cp .env.example .env            # then edit secrets (see comments in the file)
docker compose --profile dev up -d postgres redis mailpit
npm install
npm run migration:run
npm run seed                    # roles, admin user, departments, leave policy
npm run seed:demo               # optional: a demo company to click through (see below)
npm run start:dev
```

### Demo company & API collection

`npm run seed:demo` creates ~10 people across every role (CEO → managers → reports, one new
joiner still onboarding), Nigerian salary structures, an approved and a pending leave request, a
company leave policy (indexed for the AI assistant once the API's workers run) and an open
Backend Engineer job. Logins are `<key>@demo.local` (`hr@`, `eng@`, `dev1@`, `rec@`, …) with
`DEMO_PASSWORD`. Idempotent; refuses to run in production.

`npm run postman` (with the API running) regenerates `postman/` from the live OpenAPI spec:
import the collection and the *local demo* environment, run a request in **0 · Sign in** and
every other request reuses that token. Logins that hit MFA store the challenge for
**Verify MFA code**.

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
| `npm run test:e2e:docker`    | Throwaway Postgres + Redis → migrations (run, drift check, revert all, rerun) → e2e suite → teardown. `KEEP_INFRA=1` keeps the containers; `SKIP_MIGRATION_CHECKS=1` for quick reruns. Plain `test:e2e` refuses to run outside it, so it can never touch a real database |
| `npm run migration:generate -- src/database/migrations/Name` | Diff entities → new migration |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back / list    |
| `npm run migration:run:prod` | Same, against compiled `dist/` (used by the container)    |
| `npm run seed`               | Idempotent dev seeders (refuses in production)            |
| `npm run seed:demo`          | Demo company (dev only)                                    |
| `npm run seed:catalogue`     | Sync roles/permissions only — safe for production (runs on every deploy) |
| `npm run seed:admin`         | Production: create the first ADMIN from `SEED_ADMIN_*` (skips if it exists) |
| `npm run postman`            | Regenerate the Postman collection from the running API     |
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
  TOTP seeds: AES-256-GCM (`MFA_ENCRYPTION_KEY`). Recovery codes: SHA-256, single use.
- **MFA (TOTP).** `POST /auth/mfa/setup` returns a seed and `otpauth://` URI (render as a QR
  code); `POST /auth/mfa/enable {code}` confirms it and returns 10 recovery codes once. With MFA
  on, `POST /auth/login` answers `{ mfaRequired: true, mfaToken }` (5-minute challenge, useless as
  an access token) and `POST /auth/mfa/verify {mfaToken, code}` finishes with the token pair.
  Codes can't be replayed. Roles in `MFA_REQUIRED_ROLES` (default ADMIN, HR_MANAGER) get
  `403 MFA_SETUP_REQUIRED` everywhere except `/auth/me` (`mfaSetupRequired: true`), MFA setup,
  password change and logout until they enrol. Lost device: `POST /users/:id/mfa/reset`.
- **Lockout.** `LOGIN_MAX_ATTEMPTS` failed passwords or MFA codes lock the account for
  `LOGIN_LOCKOUT_MINUTES` (`423 ACCOUNT_LOCKED`, checked before the password). The counter is
  updated atomically in SQL and resets on success; `POST /users/:id/unlock` clears it.
- **Audit trail** (`GET /audit-logs`, ADMIN only, filter by actor / action / resource / dates):
  logins, failures, lockouts, MFA changes, invites, role and status changes, employee
  create/update/transfer/terminate, salary structures (create *and* view), payroll run
  transitions, payslip views, every document / résumé download. One `@Audit('action',
  'resource')` decorator per route plus a global interceptor; only whitelisted body fields (or
  just the *names* of edited fields) are kept, never values like passwords. A database trigger
  makes `audit_logs` append-only.

Seeded roles: `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`, `RECRUITER`.
Bootstrap admin comes from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (`npm run seed`, or
`npm run seed:admin` in production).

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

## Payroll

- **Salary structures** are effective-dated per employee: base pay per period, currency (defaults
  to `PAYROLL_CURRENCY`), pay frequency and typed line items (`EARNING` / `DEDUCTION`, computed as
  `FIXED`, `PERCENT_OF_BASE` or, for deductions, `PERCENT_OF_GROSS`). Creating a new structure
  closes the previous one, so history is preserved and a run always uses the structure in force
  on its period end.
- **Runs** move `DRAFT → CALCULATED → APPROVED → PAID`. `calculate` is repeatable and reports who
  was skipped (no structure, currency mismatch); `approve` freezes the payslips, renders a PDF for
  each as a `RESTRICTED` `PAYSLIP` document owned by the employee, and sends a
  `PAYSLIP_AVAILABLE` email that deliberately carries no amounts. Non-draft runs can't overlap.
- **Employees** see their own structures and payslips from approved/paid runs
  (`GET /payroll/payslips/me`, `/payroll/payslips/:id` → `documentId` → `/documents/:id/download`).
- **Nigerian statutory pay** (`PAYROLL_CALCULATOR=nigeria`, default;
  `src/modules/payroll/nigeria-payroll.calculator.ts`): contractual lines, then employee pension
  8% of basic + `HOUSING` + `TRANSPORT`, NHF 2.5% of basic, and PAYE on the Nigeria Tax Act 2025
  bands (first ₦800k free, then 15/18/21/23/25%), annualising the period's taxable pay
  (gross − pension − NHF). A structure's own `PENSION`, `NHF` or `PAYE`/`TAX` line wins over the
  computed one, so nothing is deducted twice. Joiners and leavers are included in every run that
  overlaps their employment and pro-rated by calendar days. All rates live in
  `NIGERIA_STATUTORY` — **have finance confirm them before each tax year**. Not modelled yet:
  rent relief, NHIS and life-assurance reliefs, cumulative (year-to-date) PAYE, employer costs
  (10% pension, NSITF) on reports. `simple` = contractual lines only.

## AI knowledge base & assistant

- **What gets indexed**: documents with category `POLICY` and `COMPANY` visibility. Any document
  change (new version, metadata edit, delete) emits `document.changed`; a BullMQ job on the `ai`
  queue re-evaluates it — indexing eligible documents (text extraction for PDF/DOCX/TXT/MD/CSV →
  LangChain recursive splitting → embeddings → `knowledge_chunks` with a pgvector column + HNSW
  index) and removing chunks for documents that stopped qualifying. `POST /ai/knowledge-base/reindex`
  forces one document or everything; `GET /ai/knowledge-base/status` shows counts, stale documents
  and the chat provider chain.
- **Retrieval**: cosine top-k (`AI_RETRIEVAL_TOP_K`) over pgvector, dropping hits below
  `AI_SIMILARITY_FLOOR`. If nothing qualifies the assistant answers "not found" **without calling a
  model** — no hallucinated policy, no cost.
- **Streaming** (`POST /ai/assistant/chat/stream`): the same answer as server-sent events —
  `meta` {conversationId, citations} → `delta` {text}… → `done` {full result} or `error`. Read it
  with `fetch()` and a stream reader (EventSource can't POST). Refusals that happen before the
  stream starts (not your conversation, daily cap) are ordinary JSON errors. The provider chain
  falls back until one produces its first token; Caddy is configured not to buffer it.
- **Limits & cost**: `AI_DAILY_MESSAGE_LIMIT` model-backed questions per user per UTC day
  (`429 AI_DAILY_LIMIT`; `GET /ai/usage/me` → `{used, limit}`). Every model call — assistant and
  résumé screening — is logged to `ai_usage` with tokens and an estimated USD cost from list
  prices (`src/infrastructure/ai/pricing.ts`); `GET /ai/usage` (`ai:read_usage`) reports per
  day / feature / model.
- **Answering** (`POST /ai/assistant/chat`): the last 8 turns of the conversation plus the retrieved
  excerpts go to the chat model with a grounding system prompt; answers cite excerpts as `[n]`, and
  only cited excerpts are returned as `citations`. Conversations are persisted per user
  (`/ai/assistant/conversations`).
- **Provider fallback chain**: `AI_CHAT_PROVIDERS` orders `anthropic`, `huggingface`, `openai`.
  Providers without credentials are skipped; a provider that errors (network, rate limit, auth,
  5xx, refusal, empty output) is put on a 60 s cooldown and the next one answers. Only when every
  provider fails does the endpoint return 503. Each SDK lives in its own adapter behind the
  `ChatModel` port (`src/infrastructure/ai/`). The Anthropic adapter defaults to
  `claude-haiku-5-5` and shapes each request to the model: adaptive thinking and
  `ANTHROPIC_EFFORT` on 4.6+ models, the server-side refusal fallback only on Opus 5.x / Sonnet 5.5 /
  Fable 5.1, none of these on Haiku 4.5 and older. A refusal, a `max_tokens` cut-off or empty output
  throws, so the chain moves to the next provider. Thinking tokens count against
  `AI_MAX_OUTPUT_TOKENS`.
- **Embeddings** come from the Hugging Face Inference API (`HF_EMBEDDING_MODEL`, 384 dims). The
  pgvector column is sized by the migration; switching to a model with a different dimension needs a
  migration plus a full reindex.
- `AI_DRIVER=fake` (default in `.env.example` and tests) replaces embeddings and chat with
  deterministic in-process fakes so the whole pipeline runs with no external calls.

## Recruiting & AI résumé screening

- **Openings** (`recruiting:manage`): title, department, description and a list of concrete
  requirements — the screener scores against these and nothing else. `DRAFT → OPEN → CLOSED`;
  only `OPEN` accepts applications.
- **Applications** (`POST /recruiting/openings/:id/applications`, multipart `file` + candidate
  fields): candidates are keyed by email; the résumé (PDF/DOCX/TXT/MD) is stored as a `RESUME`
  document with `RESTRICTED` visibility and no owner, so only HR's `document:read_all` or the
  recruiting endpoints (`GET /recruiting/applications/:id/resume`) can reach it.
- **Screening** runs as a BullMQ job (`recruiting` queue, 3 attempts) right after an application is
  registered, and on demand (`POST …/rescreen`). Two signals: cosine similarity between the résumé
  and job-description embeddings, and a requirement-by-requirement assessment from the chat
  fallback chain, returned as strict JSON (validated with zod; fences/chatter tolerated). The result
  is stored on the application with `aiAssisted: true`, a 0–100 `fitScore`, strengths, gaps and
  matched/missing requirements; `fit_score` is denormalised for ranking.
- **Bias guardrail**: the prompt instructs the model to judge only against listed requirements and
  to ignore protected characteristics, photos, names and employment gaps. Scores are advisory —
  status changes (`PUT /recruiting/applications/:id/status`) are always a human action and record
  who made them.
- **Ranking**: `GET /recruiting/openings/:id/applications?minScore=&status=&sort=fitScore|newest`.
- With `AI_DRIVER=fake` the screener is deterministic (keyword coverage of the requirements), which
  the e2e suite relies on.

## Production deploy (single VPS)

```bash
# DNS: point DOMAIN at the server; open ports 80 and 443.
cp .env.example .env    # NODE_ENV=production, DOMAIN, ACME_EMAIL, strong DB/Redis/JWT/MFA secrets,
                        # Cloudinary, SMTP, Anthropic + Hugging Face keys
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app npm run seed:admin   # first ADMIN, once
```

Caddy terminates TLS (Let's Encrypt, auto-renewed) and is the only service with published ports;
Postgres and Redis (password-protected, AOF on) live on the internal network. Each app start runs
pending migrations and syncs the permission catalogue before serving; a failed migration stops the
deploy. The first ADMIN must enrol in MFA at first login. Production boot refuses dev-only
settings (`STORAGE_DRIVER=memory`, `AI_DRIVER=fake`, `CORS_ORIGINS=*`, `THROTTLE_ENABLED=false`).
Still on you: database backups (`pg_dump` off-box, tested restores), monitoring, log shipping.

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
| 8 | Payroll (stub)                          | ✅     |
| 9 | AI knowledge base + RAG assistant       | ✅     |
| 10| AI resume screening                     | ✅     |
| 11| Production hardening: prod compose + TLS, audit trail, MFA + lockout, Nigerian payroll, AI caps/cost/streaming, demo seed, Postman, CI | ✅ |
