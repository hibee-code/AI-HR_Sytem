#!/usr/bin/env bash
# Restores a backup into the production database (docker-compose.prod.yml).
# DESTRUCTIVE: replaces the current data. The API is stopped during the
# restore and started again afterwards.
#
#   scripts/db-restore.sh backups/hr-20261022T020000Z.dump
set -euo pipefail
cd "$(dirname "$0")/.."
dump="${1:?usage: scripts/db-restore.sh <file.dump>}"
[[ -f "$dump" ]] || { echo "no such file: $dump" >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml)

db="$("${COMPOSE[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
echo "This REPLACES all data in database '$db' with $dump."
read -r -p "Type the database name to continue: " answer
[[ "$answer" == "$db" ]] || { echo "aborted"; exit 1; }

"${COMPOSE[@]}" stop app
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump"
"${COMPOSE[@]}" start app
echo "restored $dump into $db; the app ran pending migrations on start"
