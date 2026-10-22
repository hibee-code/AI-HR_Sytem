#!/usr/bin/env bash
# Starts throwaway Postgres (pgvector) + Redis, verifies migrations
# (run → schema matches entities → revert all → run again), runs the e2e
# suite, and tears everything down. Exit code is the first failure.
#
#   scripts/e2e-docker.sh            # migrations check + full e2e suite
#   scripts/e2e-docker.sh auth       # extra args go to jest (e.g. a file filter)
#   KEEP_INFRA=1 scripts/e2e-docker.sh   # leave containers up afterwards
#   SKIP_MIGRATION_CHECKS=1 scripts/e2e-docker.sh auth   # faster reruns
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.test.yml)

# Explicit values win over .env (dotenv never overrides the environment), so
# the suite can't reach real databases, Slack, SMTP or AI providers.
export NODE_ENV=test E2E_ISOLATED=1
# Must match docker-compose.test.yml.
export DB_HOST=127.0.0.1 DB_PORT=5433 DB_USERNAME=postgres DB_PASSWORD=root
export DB_NAME=HR_System DB_TEST_NAME=HR_System DB_SSL=false DB_LOGGING=false
export REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_PASSWORD= REDIS_DB=0
export SLACK_BOT_TOKEN= SMTP_HOST=127.0.0.1 SMTP_USER= SMTP_PASSWORD=
export STORAGE_DRIVER=memory AI_DRIVER=fake THROTTLE_ENABLED=false
export HF_API_TOKEN= ANTHROPIC_API_KEY= OPENAI_API_KEY=
export JWT_ACCESS_SECRET=e2e-access-secret-e2e-access-secret-000000
export JWT_REFRESH_SECRET=e2e-refresh-secret-e2e-refresh-secret-00000
export MFA_ENCRYPTION_KEY=e2e-mfa-key-e2e-mfa-key-e2e-mfa-key-000
# The suites log in as ADMIN everywhere; MFA enforcement has its own tests.
export MFA_REQUIRED_ROLES=

cleanup() {
  if [[ "${KEEP_INFRA:-0}" != "1" ]]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "▶ starting test infrastructure"
"${COMPOSE[@]}" up -d --wait

if [[ "${SKIP_MIGRATION_CHECKS:-0}" != "1" ]]; then
echo "▶ migrations: run"
npm run --silent migration:run >/dev/null && echo "  all migrations applied"

echo "▶ migrations: schema drift check (entities vs. migrations)"
drift_dir="$(mktemp -d)"
if npm run --silent typeorm -- migration:generate --dryrun --check "$drift_dir/Drift" >"$drift_dir/out.log" 2>&1; then
  echo "  no drift"
else
  cat "$drift_dir/out.log"
  echo "✖ entities and migrations disagree (see SQL above)"
  exit 1
fi

echo "▶ migrations: revert all, then run again"
count="$(ls src/database/migrations/*.ts | wc -l)"
for _ in $(seq "$count"); do npm run --silent migration:revert >/dev/null; done
npm run --silent migration:run >/dev/null
echo "  ${count} migrations reverted and re-applied"
fi

echo "▶ e2e suite"
npm run test:e2e -- "$@"
