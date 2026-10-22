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

# ── Credentials for the throwaway stack ──────────────────────────────────
# Precedence: already in the environment (e.g. CI) → TEST_* in .env → random
# for this run. Only these four keys are read from .env — never the whole
# file, so the real DB_/REDIS_ settings can't leak into the suite.
dotenv_value() {
  [[ -f .env ]] || return 0
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}
random_secret() { openssl rand -hex 24; }
for key in TEST_DB_USERNAME TEST_DB_PASSWORD TEST_DB_NAME TEST_REDIS_PASSWORD; do
  if [[ -z "${!key:-}" ]]; then
    value="$(dotenv_value "$key")"
    case "$key" in
      TEST_DB_USERNAME) default=hr_test ;;
      TEST_DB_NAME) default=hr_system_test ;;
      *) default="$(random_secret)" ;;
    esac
    export "$key=${value:-$default}"
  fi
done

# Explicit values win over .env (dotenv never overrides the environment), so
# the suite can't reach real databases, Slack, SMTP or AI providers.
export NODE_ENV=test E2E_ISOLATED=1
# Ports must match docker-compose.test.yml.
export DB_HOST=127.0.0.1 DB_PORT=5433 DB_SSL=false DB_LOGGING=false
export DB_USERNAME="$TEST_DB_USERNAME" DB_PASSWORD="$TEST_DB_PASSWORD"
export DB_NAME="$TEST_DB_NAME" DB_TEST_NAME="$TEST_DB_NAME"
export REDIS_HOST=127.0.0.1 REDIS_PORT=6380 REDIS_PASSWORD="$TEST_REDIS_PASSWORD" REDIS_DB=0
export SLACK_BOT_TOKEN= SMTP_HOST=127.0.0.1 SMTP_USER= SMTP_PASSWORD=
export STORAGE_DRIVER=memory AI_DRIVER=fake THROTTLE_ENABLED=false
export HF_API_TOKEN= ANTHROPIC_API_KEY= OPENAI_API_KEY=
# Signing / encryption keys are only meaningful for one run: always fresh.
export JWT_ACCESS_SECRET="$(random_secret)" JWT_REFRESH_SECRET="$(random_secret)"
export MFA_ENCRYPTION_KEY="$(random_secret)"
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
