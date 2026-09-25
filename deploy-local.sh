#!/usr/bin/env bash
# Run the full production stack (API, workers, scheduler, web, Postgres/pgvector, Redis, Caddy)
# on this machine. Emails go through Resend (set RESEND_API_KEY + EMAIL_FROM in .env) or are logged.
# Usage:
#   ./deploy-local.sh            build and start, run migrations, wait for health, print URLs
#   ./deploy-local.sh infra      only Postgres + Redis (for `npm run dev`)
#   ./deploy-local.sh down       stop (keeps the database volume)
#   ./deploy-local.sh logs       follow api/worker/scheduler logs
#   ./deploy-local.sh status     show containers and health
#   ./deploy-local.sh reset      stop and delete local volumes (database, queues, uploads)
# Env: JOBAGENT_LOCAL_PORT (default 8081).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export JOBAGENT_LOCAL_PORT="${JOBAGENT_LOCAL_PORT:-8081}"
PORT="$JOBAGENT_LOCAL_PORT"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and try again."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."

if [[ ! -f .env ]]; then
  cp .env.example .env
  log "Created .env from .env.example."
fi

compose() { docker compose --profile full "$@"; }

case "${1:-up}" in
  up) ;;
  infra)
    docker compose up -d db redis
    log "Postgres :5435 · Redis :6381"
    echo "Next: npm install && npm run migrate && npm run dev"
    exit 0
    ;;
  down)
    compose down
    exit 0
    ;;
  logs)
    compose logs -f --tail 100 api worker scheduler
    exit 0
    ;;
  status)
    compose ps
    exit 0
    ;;
  reset)
    if [[ -t 0 ]]; then
      read -r -p "Delete the local database, queues and uploaded resumes? [y/N]: " yn || true
      [[ "$yn" == [yY]* ]] || exit 1
    fi
    compose down -v
    exit 0
    ;;
  *)
    die "Unknown command '$1'. Use: up | infra | down | logs | status | reset"
    ;;
esac

# Something else on the port makes Caddy fail to bind.
if command -v lsof >/dev/null && lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P 2>/dev/null \
    | grep -v -i docker | grep -v com.docke | tail -n +2 | grep -q .; then
  die "Port $PORT is already in use. Free it or run: JOBAGENT_LOCAL_PORT=8090 ./deploy-local.sh"
fi

log "Building images (the first build takes a few minutes)."
compose build migrate web

log "Starting the stack (migrations + seed run first)."
compose up -d --remove-orphans

log "Waiting for the API and web app to report healthy."
healthy=""
for _ in $(seq 1 90); do
  api="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || true)"
  web="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)" 2>/dev/null || true)"
  if [[ "$api" == "healthy" && "$web" == "healthy" ]]; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ -z "$healthy" ]]; then
  compose logs --tail 60 migrate api web || true
  die "The stack did not become healthy. Logs above."
fi

if command -v curl >/dev/null && ! curl -fsS --max-time 10 "http://localhost:${PORT}/health" >/dev/null; then
  compose logs --tail 30 caddy || true
  die "The API is healthy but Caddy on :${PORT} did not answer. Logs above."
fi

log "AI Job Agent is running."
echo "Dashboard:  http://localhost:${PORT}"
echo "API health: http://localhost:${PORT}/health   ·  OpenAPI: http://localhost:${PORT}/api/v1/openapi.json"
if grep -qE '^RESEND_API_KEY=.+' .env; then echo "Emails:     sent via Resend"; else echo "Emails:     logged only (set RESEND_API_KEY in .env to deliver via Resend)"; fi
echo "Sign in with the local dev form (or Google if GOOGLE_CLIENT_ID is set and http://localhost:${PORT} is an authorized origin)."
echo
echo "Logs: ./deploy-local.sh logs    Stop: ./deploy-local.sh down"
