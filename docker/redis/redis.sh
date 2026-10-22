#!/bin/sh
# Shared by every docker-compose file. REDIS_PASSWORD comes from the container
# environment (set from .env) and is written to a private config file, so it
# never appears in a command line (`ps`, `docker inspect`, healthcheck logs).
#
#   redis.sh [redis-server options…]   start the server (empty password = no auth)
#   redis.sh --health                  healthcheck
set -eu

if [ "${1:-}" = "--health" ]; then
  # REDISCLI_AUTH keeps the password out of redis-cli's arguments.
  if [ -n "${REDIS_PASSWORD:-}" ]; then export REDISCLI_AUTH="$REDIS_PASSWORD"; fi
  redis-cli ping | grep -q PONG
  exit
fi

conf=/tmp/redis.conf
umask 077
if [ -n "${REDIS_PASSWORD:-}" ]; then
  printf 'requirepass "%s"\n' "$REDIS_PASSWORD" > "$conf"
else
  : > "$conf"
fi
# The image's entrypoint drops root and runs redis-server as the redis user.
[ "$(id -u)" = 0 ] && chown redis:redis "$conf"
exec docker-entrypoint.sh redis-server "$conf" "$@"
