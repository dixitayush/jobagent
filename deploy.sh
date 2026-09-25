#!/usr/bin/env bash
# Deploy AI Job Agent behind the Traefik gateway
# (private Caddy + API + workers + scheduler + Next.js + Postgres/pgvector + Redis).
# Prerequisite: repo-root ../setup.sh (Docker + Traefik + `proxy` network) already ran on the VPS.
# Usage:
#   ./deploy.sh                          from a laptop: rsync to the VPS, then deploy there
#   ./deploy.sh                          on the VPS: build and (re)start the stack
#   JOBAGENT_HOST=jobs.example.com APP_URL=https://jobs.example.com ./deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

COMPOSE_FILE=docker-compose.prod.yml
DEPLOY_HOST="${DEPLOY_HOST:-root@200.234.41.108}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/shurbe-data/jobagent}"
VPS_IP="${VPS_IP:-200.234.41.108}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# From a laptop (macOS): sync this folder to the VPS and run this same script there.
# Works with password or key auth; one shared SSH connection means one password prompt.
remote_deploy() {
  command -v rsync >/dev/null || die "rsync is required on the laptop."
  command -v ssh >/dev/null || die "ssh is required on the laptop."

  local host="${JOBAGENT_HOST:-jobagent.ayushdixit.work}"
  if command -v dig >/dev/null; then
    local resolved
    resolved="$(dig +short "$host" A | tail -1)"
    if [[ "$resolved" != "$VPS_IP" ]]; then
      printf '\nWARNING: %s resolves to "%s", not %s.\n' "$host" "${resolved:-nothing}" "$VPS_IP"
      printf 'Add an A record  %s → %s  first, or Let'"'"'s Encrypt cannot issue a certificate.\n' "${host%%.*}" "$VPS_IP"
      if [[ -t 0 ]]; then
        read -r -p "Deploy anyway? [y/N]: " yn || true
        [[ "$yn" == [yY]* ]] || exit 1
      fi
    fi
  fi

  local sock_dir
  sock_dir="$(mktemp -d)"
  local ssh_opts=(-o ControlMaster=auto -o "ControlPath=$sock_dir/%C" -o ControlPersist=300 -o ConnectTimeout=15)
  trap 'ssh "${ssh_opts[@]}" -O exit "$DEPLOY_HOST" >/dev/null 2>&1 || true; rm -rf "$sock_dir"' EXIT

  log "Connecting to $DEPLOY_HOST"
  ssh "${ssh_opts[@]}" "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR'"

  log "Syncing jobagent → ${DEPLOY_HOST}:${DEPLOY_DIR}"
  # .env is excluded, so the server keeps its own secrets across deploys.
  rsync -az --delete \
    -e "ssh ${ssh_opts[*]}" \
    --include .env.example \
    --exclude node_modules --exclude .next --exclude dist --exclude .git --exclude .data \
    --exclude graphify-out --exclude coverage --exclude '*.tsbuildinfo' \
    --exclude .env --exclude '.env.*' --exclude .DS_Store \
    "$ROOT/" "${DEPLOY_HOST}:${DEPLOY_DIR}/"

  log "Running deploy on ${DEPLOY_HOST}"
  ssh -t "${ssh_opts[@]}" "$DEPLOY_HOST" \
    "cd '$DEPLOY_DIR' && chmod +x deploy.sh deploy-local.sh && \
     JOBAGENT_HOST='${JOBAGENT_HOST:-}' APP_URL='${APP_URL:-}' POSTGRES_PASSWORD='${POSTGRES_PASSWORD:-}' \
     GOOGLE_CLIENT_ID='${GOOGLE_CLIENT_ID:-}' OPENAI_API_KEY='${OPENAI_API_KEY:-}' \
     RESEND_API_KEY='${RESEND_API_KEY:-}' EMAIL_FROM='${EMAIL_FROM:-}' ./deploy.sh"
}

if [[ "$(uname -s)" != "Linux" ]]; then
  remote_deploy
  exit 0
fi

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  die "Docker is not reachable. Run ../setup.sh on the VPS first."
fi

compose() { "${DOCKER[@]}" compose -f "$COMPOSE_FILE" --env-file .env "$@"; }

prompt() {
  local var="$1" message="$2" default="${3:-}"
  local current=""
  eval "current=\"\${${var}-}\""
  if [[ -n "$current" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    return 1
  fi
  local reply
  if [[ -n "$default" ]]; then
    read -r -p "$message [$default]: " reply || true
    printf -v "$var" '%s' "${reply:-$default}"
  else
    read -r -p "$message: " reply || true
    printf -v "$var" '%s' "$reply"
  fi
}

env_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- || true
}

upsert_env() {
  local file="$1" key="$2" value="$3"
  local tmp
  tmp="$(mktemp)"
  KEY="$key" VAL="$value" awk '
    BEGIN { k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0 }
    $0 ~ "^#? ?" k "=" { if (!done) { print k "=" v; done=1 } next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
}

random_secret() {
  if command -v openssl >/dev/null; then
    openssl rand -base64 64 | tr -d '\n=/+' | head -c "$1"
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"
  fi
}

if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || die "Missing .env.example."
  cp .env.example .env
  log "Created .env from .env.example."
fi

JOBAGENT_HOST="${JOBAGENT_HOST:-$(env_get .env JOBAGENT_HOST)}"
APP_URL="${APP_URL:-$(env_get .env APP_URL)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(env_get .env POSTGRES_PASSWORD)}"
JWT_SECRET="$(env_get .env JWT_SECRET)"
INTERNAL_API_TOKEN="$(env_get .env INTERNAL_API_TOKEN)"
ENCRYPTION_KEY="$(env_get .env ENCRYPTION_KEY)"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(env_get .env GOOGLE_CLIENT_ID)}"
OPENAI_API_KEY="${OPENAI_API_KEY:-$(env_get .env OPENAI_API_KEY)}"
RESEND_API_KEY="${RESEND_API_KEY:-$(env_get .env RESEND_API_KEY)}"
EMAIL_FROM="${EMAIL_FROM:-$(env_get .env EMAIL_FROM)}"

# The example ships local-dev values; never deploy them.
[[ "${APP_URL:-}" == http://localhost* ]] && APP_URL=""
[[ "${POSTGRES_PASSWORD:-}" == "jobagent" ]] && POSTGRES_PASSWORD=""
[[ "${JWT_SECRET:-}" == dev-* ]] && JWT_SECRET=""
[[ "${INTERNAL_API_TOKEN:-}" == dev-* ]] && INTERNAL_API_TOKEN=""
[[ "${ENCRYPTION_KEY:-}" == "ZGV2LWVuY3J5cHRpb24ta2V5LTMyLWJ5dGVzLWxvbmc=" ]] && ENCRYPTION_KEY=""

prompt JOBAGENT_HOST "Public hostname" "jobagent.ayushdixit.work" || true
if [[ -z "${APP_URL:-}" && -n "${JOBAGENT_HOST:-}" ]]; then
  APP_URL="https://${JOBAGENT_HOST}"
fi
prompt APP_URL "Public https URL" "${APP_URL:-https://jobagent.ayushdixit.work}" || true

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  [[ -t 0 ]] && { prompt POSTGRES_PASSWORD "Postgres password (blank = generate)" || true; }
  if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
    POSTGRES_PASSWORD="$(random_secret 32)"
    log "Generated POSTGRES_PASSWORD and wrote it to .env."
  fi
fi
if [[ -z "${JWT_SECRET:-}" ]]; then JWT_SECRET="$(random_secret 64)"; log "Generated JWT_SECRET."; fi
if [[ -z "${INTERNAL_API_TOKEN:-}" ]]; then INTERNAL_API_TOKEN="$(random_secret 40)"; log "Generated INTERNAL_API_TOKEN."; fi
if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
  # Generated once and kept: changing it later makes stored resumes unreadable.
  ENCRYPTION_KEY="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)"
  log "Generated ENCRYPTION_KEY (back up .env — it decrypts stored resumes)."
fi
if [[ -z "${GOOGLE_CLIENT_ID:-}" ]]; then
  prompt GOOGLE_CLIENT_ID "Google OAuth client ID (blank = set later in .env)" || true
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  prompt OPENAI_API_KEY "OpenAI API key (blank = rules + local vector matching only)" || true
fi
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  prompt RESEND_API_KEY "Resend API key (blank = emails are only logged)" || true
fi
prompt EMAIL_FROM "Sender (domain verified in Resend)" "AI Job Agent <jobs@${JOBAGENT_HOST#*.}>" || true

[[ -n "${JOBAGENT_HOST:-}" ]] || die "Set JOBAGENT_HOST (e.g. jobagent.ayushdixit.work)."
[[ "${APP_URL:-}" == https://* ]] || die "Set APP_URL to the public https URL."
[[ "$POSTGRES_PASSWORD" =~ ^[A-Za-z0-9]+$ ]] || die "POSTGRES_PASSWORD must be letters and digits only (it goes into a connection URL)."

upsert_env .env JOBAGENT_HOST "$JOBAGENT_HOST"
upsert_env .env APP_URL "$APP_URL"
upsert_env .env API_PUBLIC_URL "$APP_URL"
upsert_env .env CORS_ORIGINS "$APP_URL"
upsert_env .env APP_ENV "production"
upsert_env .env AUTH_DEV_LOGIN "false"
upsert_env .env POSTGRES_USER "jobagent"
upsert_env .env POSTGRES_DB "jobagent"
upsert_env .env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
upsert_env .env JWT_SECRET "$JWT_SECRET"
upsert_env .env INTERNAL_API_TOKEN "$INTERNAL_API_TOKEN"
upsert_env .env ENCRYPTION_KEY "$ENCRYPTION_KEY"
upsert_env .env GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
upsert_env .env LLM_PROVIDER "openai"
upsert_env .env OPENAI_API_KEY "${OPENAI_API_KEY:-}"
upsert_env .env EMAIL_PROVIDER "resend"
upsert_env .env RESEND_API_KEY "${RESEND_API_KEY:-}"
[[ -n "${EMAIL_FROM:-}" ]] && upsert_env .env EMAIL_FROM "$EMAIL_FROM"
# Compose builds internal URLs itself; drop the laptop ones so nothing is confused.
upsert_env .env DATABASE_URL "postgres://jobagent:${POSTGRES_PASSWORD}@db:5432/jobagent"
upsert_env .env REDIS_URL "redis://redis:6379"
upsert_env .env STORAGE_LOCAL_DIR "/data/uploads"
chmod 600 .env

if ! "${DOCKER[@]}" network inspect proxy >/dev/null 2>&1; then
  die "Docker network 'proxy' is missing. From the repo root run: ./setup.sh"
fi

if ! "${DOCKER[@]}" ps --filter "label=com.docker.compose.project=gateway" \
      --filter "label=com.docker.compose.service=traefik" \
      --filter "status=running" --format '{{.Names}}' | grep -q .; then
  die "Traefik is not running. From the repo root run: ./setup.sh"
fi

log "Building images (the first build takes a few minutes)."
compose build migrate web

log "Starting AI Job Agent (migrations run first)."
compose up -d --remove-orphans

log "Waiting for the API and web app to report healthy."
healthy=""
for _ in $(seq 1 60); do
  api="$("${DOCKER[@]}" inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || true)"
  web="$("${DOCKER[@]}" inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)" 2>/dev/null || true)"
  if [[ "$api" == "healthy" && "$web" == "healthy" ]]; then
    healthy=1
    break
  fi
  sleep 3
done
if [[ -z "$healthy" ]]; then
  compose logs --tail 60 migrate api web || true
  die "The stack did not become healthy. Logs above."
fi

# Old image layers from previous deploys pile up on a small VPS.
"${DOCKER[@]}" image prune -f >/dev/null 2>&1 || true

log "AI Job Agent is up on the private network."
echo "Public URL: $APP_URL"
echo "Traefik routes Host($JOBAGENT_HOST) → Caddy → /api → api:4000, everything else → web:3000."
echo "Health:     $APP_URL/health"
echo "Logs:       docker compose -f $COMPOSE_FILE logs -f api worker scheduler"
if [[ -z "$(env_get .env RESEND_API_KEY)" ]]; then
  echo "WARNING: RESEND_API_KEY is empty — digests are logged, not emailed."
fi
if [[ -z "$(env_get .env OPENAI_API_KEY)" ]]; then
  echo "NOTE: OPENAI_API_KEY is empty — matching uses rules + local embeddings only."
fi
if [[ -z "$(env_get .env GOOGLE_CLIENT_ID)" ]]; then
  echo "WARNING: GOOGLE_CLIENT_ID is empty — nobody can sign in until you set it in .env and rerun ./deploy.sh."
fi
if command -v curl >/dev/null; then
  if curl -fsS --max-time 10 "$APP_URL/health" >/dev/null 2>&1; then
    echo "Public health check: OK"
  else
    echo "Public health check did not answer yet (DNS or the first Let's Encrypt certificate can take a minute)."
  fi
fi
