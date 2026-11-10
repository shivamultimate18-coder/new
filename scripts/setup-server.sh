#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu server (pilot: app, worker, database and HTTPS on
# one machine). Run from the repository folder as root:
#
#   sudo bash scripts/setup-server.sh
#
# Safe to run again: it keeps an existing .env, skips an admin login that already exists,
# and registers Unipile webhooks only once.
#
# It asks for your domain and API keys. Keys are typed here, on your server, and stored
# only in .env (readable by root only). Never paste them into chats or tickets.
#
# SETUP_DRY_RUN=1 writes .env to SETUP_ENV_FILE (default .env) and prints the remaining
# steps instead of running them (used to test this script).
set -euo pipefail

cd "$(dirname "$0")/.."
DRY_RUN="${SETUP_DRY_RUN:-}"
ENV_FILE="${SETUP_ENV_FILE:-.env}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!   %s\033[0m\n' "$*"; }
die() { printf '\033[31mx   %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [[ -n "$DRY_RUN" ]]; then echo "[dry run] $*"; else "$@"; fi; }

ask() { # ask VAR "Question" "default"
  local var="$1" q="$2" def="${3:-}" ans
  if [[ -n "$def" ]]; then read -r -p "$q [$def]: " ans; ans="${ans:-$def}"; else read -r -p "$q: " ans; fi
  printf -v "$var" '%s' "$ans"
}
ask_secret() { # ask_secret VAR "Question"  (input is not shown)
  local var="$1" q="$2" ans
  read -r -s -p "$q (hidden): " ans; echo
  printf -v "$var" '%s' "$ans"
}
rand() { openssl rand -hex "$1"; }

[[ -n "$DRY_RUN" || $EUID -eq 0 ]] || die "Run as root: sudo bash scripts/setup-server.sh"
command -v openssl >/dev/null || die "openssl is missing (apt-get install -y openssl)."

# 1. Docker -------------------------------------------------------------------
say "1/7 Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "Docker is installed."
else
  echo "Installing Docker (official script from get.docker.com)…"
  run sh -c "curl -fsSL https://get.docker.com | sh"
fi

# 2. Settings (.env) ----------------------------------------------------------
say "2/7 Settings"
if [[ -f "$ENV_FILE" ]] && grep -q '^AUTH_SECRET=.\+' "$ENV_FILE"; then
  echo "$ENV_FILE already exists; keeping it. Edit it by hand to change a setting."
else
  echo "Answer a few questions. Press Enter to accept a [default]."
  ask DOMAIN "Domain for the app, e.g. app.yourcompany.com"
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "That does not look like a domain name: $DOMAIN"
  ask TZ_NAME "Your team's timezone (e.g. Asia/Kolkata, America/New_York)" "UTC"
  ask UNIPILE_DSN "Unipile DSN from dashboard.unipile.com, e.g. api8.unipile.com:13851"
  UNIPILE_DSN="${UNIPILE_DSN#https://}"; UNIPILE_DSN="${UNIPILE_DSN%/}"
  [[ "$UNIPILE_DSN" =~ ^[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "That does not look like a Unipile DSN: $UNIPILE_DSN"
  ask_secret UNIPILE_API_KEY "Unipile API key"
  [[ -n "$UNIPILE_API_KEY" ]] || die "The Unipile API key is required."
  ask_secret ANTHROPIC_API_KEY "Anthropic API key (set a monthly spend limit on it in the Anthropic Console)"
  [[ -n "$ANTHROPIC_API_KEY" ]] || die "The Anthropic API key is required."

  PG_PASSWORD="$(rand 24)"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Written by scripts/setup-server.sh on $(date -u +%Y-%m-%dT%H:%MZ). Readable by root only.
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
APP_TIMEZONE=$TZ_NAME
POSTGRES_PASSWORD=$PG_PASSWORD
DATABASE_URL=postgres://outreach:$PG_PASSWORD@db:5432/outreach
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
UNIPILE_DSN=$UNIPILE_DSN
UNIPILE_API_KEY=$UNIPILE_API_KEY
UNIPILE_WEBHOOK_SECRET=$(rand 24)
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
UNIPILE_MOCK=
AI_MOCK=
EOF
  chmod 600 "$ENV_FILE"
  echo "Saved $ENV_FILE (secrets generated for the database, sign-in sessions and webhooks)."
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

# 3. DNS ----------------------------------------------------------------------
say "3/7 Domain"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [[ -z "$DNS_IP" ]]; then
  warn "$DOMAIN does not resolve yet. Add a DNS A record for it pointing to ${SERVER_IP:-the IP address of this server}."
  warn "HTTPS will start working a few minutes after the record is live; setup continues."
elif [[ -n "$SERVER_IP" && "$DNS_IP" != "$SERVER_IP" ]]; then
  warn "$DOMAIN points to $DNS_IP, but this server is $SERVER_IP. Fix the A record, or HTTPS will fail."
else
  echo "$DOMAIN points to this server ($DNS_IP)."
fi

# 4. Start --------------------------------------------------------------------
say "4/7 Building and starting (first build takes a few minutes)"
run docker compose --profile with-db up -d --build
if [[ -z "$DRY_RUN" ]]; then
  echo -n "Waiting for the database"
  for _ in $(seq 1 60); do
    if docker compose exec -T db pg_isready -U outreach >/dev/null 2>&1; then echo " ready."; break; fi
    echo -n "."; sleep 2
  done
fi

# 5. Database tables ----------------------------------------------------------
say "5/7 Database tables"
run docker compose run --rm app npx tsx scripts/migrate.ts

# 6. Admin login --------------------------------------------------------------
say "6/7 Your admin login"
if [[ -n "$DRY_RUN" ]]; then
  echo "[dry run] docker compose run --rm app npx tsx scripts/create-user.ts <email> <name> admin"
else
  ask ADMIN_EMAIL "Your email (for signing in)"
  ask ADMIN_NAME "Your name"
  echo "A password will be generated and shown once. Save it in your password manager."
  docker compose run --rm app npx tsx scripts/create-user.ts "$ADMIN_EMAIL" "$ADMIN_NAME" admin \
    || warn "Could not create the login (it may already exist). To add people later, use Settings > Team."
fi

# 7. Unipile webhooks ---------------------------------------------------------
say "7/7 Unipile webhooks"
MARKER=".webhooks-registered"
if [[ -f "$MARKER" ]]; then
  echo "Already registered on $(cat "$MARKER"). Delete $MARKER to register again."
else
  if run docker compose run --rm app npx tsx --conditions=react-server scripts/register-webhooks.ts; then
    [[ -n "$DRY_RUN" ]] || date -u +%Y-%m-%dT%H:%MZ > "$MARKER"
  else
    warn "Webhook registration failed. Check UNIPILE_DSN and UNIPILE_API_KEY in $ENV_FILE, then run this script again."
  fi
fi

# Done ------------------------------------------------------------------------
say "Checking https://$DOMAIN"
if [[ -z "$DRY_RUN" ]]; then
  ok=""
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 5
  done
  if [[ -n "$ok" ]]; then
    echo "The app is live at https://$DOMAIN"
  else
    warn "https://$DOMAIN is not answering yet. Usually the DNS record is not live yet; Caddy gets the"
    warn "HTTPS certificate on its own once it is. Logs: docker compose logs caddy app"
  fi
fi

cat <<EOF

Next (docs/PILOT.md, section 3):
  1. Sign in at https://$DOMAIN
  2. Settings > AI usage: set a monthly limit
  3. Accounts > Connect account: one established LinkedIn account, left switched off
  4. Voice, Lead Sources (about 20 leads), Campaigns (Review every lead), then switch the account on
  5. Turn on backups for this server in the Hetzner console

Useful:
  Stop all sending at once:   docker compose stop worker
  Engine log:                 docker compose logs -f worker
  Update to the latest code:  git pull && docker compose --profile with-db up -d --build && docker compose run --rm app npx tsx scripts/migrate.ts
EOF
