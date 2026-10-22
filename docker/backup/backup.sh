#!/bin/sh
# Nightly PostgreSQL backups for docker-compose.prod.yml (the `backup` service).
# Credentials come from the environment (set from .env), never arguments.
#
#   backup.sh           run forever: one dump per day at BACKUP_HOUR_UTC
#   backup.sh --once    one dump now (manual / before an upgrade)
#
# Each dump is checked with `pg_restore --list`, dumps older than
# BACKUP_KEEP_DAYS are deleted, and BACKUP_UPLOAD_CMD (optional) is run with
# the dump's path so a copy leaves the server, e.g.
#   BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:hr-backups'
set -eu
: "${BACKUP_KEEP_DAYS:=14}"
: "${BACKUP_HOUR_UTC:=2}"
DIR=/backups

dump() {
  file="$DIR/hr-$(date -u +%Y%m%dT%H%M%SZ).dump"
  echo "backup: writing $file"
  pg_dump --format=custom --no-owner --file="$file.partial"
  pg_restore --list "$file.partial" > /dev/null   # unreadable dump = failure
  mv "$file.partial" "$file"
  ln -sf "$(basename "$file")" "$DIR/latest.dump"
  echo "backup: ok ($(du -h "$file" | cut -f1))"
  find "$DIR" -name 'hr-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -print -delete
  if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
    sh -c "$BACKUP_UPLOAD_CMD" upload "$file" && echo "backup: uploaded"
  fi
}

seconds_until_next_run() {
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR_UTC}:00:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  echo $((next - now))
}

mkdir -p "$DIR"
if [ "${1:-}" = "--once" ]; then dump; exit; fi
while true; do
  wait_s=$(seconds_until_next_run)
  echo "backup: next run in $((wait_s / 3600))h$(((wait_s % 3600) / 60))m"
  sleep "$wait_s"
  dump || echo "backup: FAILED — check the logs and disk space" >&2
done
