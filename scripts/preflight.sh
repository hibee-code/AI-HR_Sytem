#!/usr/bin/env bash
# Checks a server before `docker compose -f docker-compose.prod.yml up -d`:
#   .env is complete for production · DOMAIN resolves to this server ·
#   ports 80/443 are free (Caddy needs both to get its certificate).
# Prints a checklist; exit code 1 if anything blocks the deploy.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
val()  { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/'; }

echo "Tools"
command -v docker >/dev/null && ok "docker" || bad "docker is not installed"
docker compose version >/dev/null 2>&1 && ok "docker compose" || bad "docker compose plugin missing"

echo ".env"
if [[ ! -f .env ]]; then bad ".env not found (copy .env.example)"; else
  [[ "$(val NODE_ENV)" == production ]] && ok "NODE_ENV=production" || bad "NODE_ENV must be production"
  for k in DOMAIN ACME_EMAIL DB_USERNAME DB_PASSWORD DB_NAME REDIS_PASSWORD \
           JWT_ACCESS_SECRET JWT_REFRESH_SECRET MFA_ENCRYPTION_KEY CORS_ORIGINS APP_URL; do
    [[ -n "$(val "$k")" ]] && ok "$k set" || bad "$k is empty"
  done
  for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET MFA_ENCRYPTION_KEY; do
    v="$(val "$k")"; [[ ${#v} -ge 32 ]] || bad "$k shorter than 32 characters"
    [[ "$v" == *change-me* ]] && bad "$k is still a placeholder"
  done
  [[ "$(val STORAGE_DRIVER)" == memory ]] && bad "STORAGE_DRIVER=memory loses uploads"
  [[ -n "$(val BACKUP_UPLOAD_CMD)" ]] || warn "BACKUP_UPLOAD_CMD empty: backups stay on this server only"
fi

echo "DNS"
domain="$(val DOMAIN)"
if [[ -n "$domain" ]]; then
  resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1{print $1}')"
  public="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$resolved" ]]; then bad "$domain does not resolve (create an A record)"
  elif [[ -z "$public" ]]; then warn "$domain → $resolved (couldn't detect this server's public IP to compare)"
  elif [[ "$resolved" == "$public" ]]; then ok "$domain → $resolved (this server)"
  else bad "$domain → $resolved, but this server is $public"; fi
fi

echo "Ports"
http_port="$(val HTTP_PORT)"; https_port="$(val HTTPS_PORT)"
for port in "${http_port:-80}" "${https_port:-443}"; do
  holder="$(ss -ltnpH "sport = :$port" 2>/dev/null | head -n1)"
  if [[ -z "$holder" ]]; then ok "port $port free"
  elif [[ "$holder" == *docker-proxy* ]]; then warn "port $port held by Docker (fine if it's this stack's Caddy)"
  else bad "port $port in use: $holder"; fi
done
[[ "$(val HTTP_PORT)" =~ ^(|80)$ ]] || warn "HTTP_PORT isn't 80: Let's Encrypt's HTTP challenge needs public port 80"

echo
if [[ $fail -eq 0 ]]; then echo "Ready to deploy."; else echo "Fix the ✗ items first."; fi
exit $fail
