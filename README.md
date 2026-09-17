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
| `npm run lint` / `format`    | oxlint / prettier                                         |

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

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there and validated at boot.

## Build stages

| # | Stage                                   | Status |
| - | --------------------------------------- | ------ |
| 0 | Scaffold, config, logging, DB, health   | ✅     |
| 1 | Auth, users, RBAC                       |        |
| 2 | Employees, departments, positions       |        |
| 3 | Queues + notifications (Slack, email)   |        |
| 4 | Onboarding / offboarding                |        |
| 5 | Leave & attendance                      |        |
| 6 | Documents (Cloudinary)                  |        |
| 7 | Performance reviews                     |        |
| 8 | Payroll (stub)                          |        |
| 9 | AI knowledge base + RAG assistant       |        |
| 10| AI resume screening                     |        |
