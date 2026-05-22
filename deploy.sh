#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# PCI Nexus — production deploy script
#
# Runs on the VPS, next to docker-compose.yml.
#
# Steps (in order, each fails loudly):
#   1. Sanity-check toolchain + backend/.env.
#   2. Validate the Caddyfile syntax BEFORE touching the running stack.
#   3. git pull --ff-only (skippable with --no-pull).
#   4. docker compose build --pull (skippable with --no-build).
#   5. docker compose pull caddy (for base-image security updates).
#   6. docker compose up -d --remove-orphans.
#   7. Wait until the backend container reports "healthy".
#   8. Hot-reload Caddy with the on-disk Caddyfile (no downtime). Falls back to
#      `docker compose restart caddy` if the reload call fails.
#   9. Smoke-test the public /health endpoint.
#
# Usage:
#   ./deploy.sh                  full deploy
#   ./deploy.sh --no-pull        don't git pull (deploy local changes)
#   ./deploy.sh --no-build       reuse existing images (config-only redeploy)
#   ./deploy.sh --skip-smoke     don't curl the public /health URL
#   ./deploy.sh --help           print this help
#
# Env overrides:
#   HEALTH_URL              public health URL  (default: https://nexuspci.com/health)
#   HEALTH_TIMEOUT_SEC      seconds to wait for backend healthcheck (default: 180)
#   COMPOSE_PROJECT_NAME    forwarded to docker compose
# ----------------------------------------------------------------------------

set -Eeuo pipefail

# ---------- terminal formatting ----------
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; BOLD=""; NC=""
fi

ts()   { date +%H:%M:%S; }
log()  { printf '%s[%s]%s %s\n'    "${CYAN}"   "$(ts)" "${NC}" "$*"; }
ok()   { printf '%s[%s] OK%s  %s\n' "${GREEN}" "$(ts)" "${NC}" "$*"; }
warn() { printf '%s[%s] !!%s  %s\n' "${YELLOW}" "$(ts)" "${NC}" "$*"; }
err()  { printf '%s[%s] XX%s  %s\n' "${RED}"   "$(ts)" "${NC}" "$*" >&2; }

# ---------- error trap ----------
on_error() {
  local exit_code=$?
  local line=$1
  err "deploy.sh failed at line ${line} (exit ${exit_code})"
  exit "${exit_code}"
}
trap 'on_error $LINENO' ERR

# ---------- argument parsing ----------
DO_PULL=1
DO_BUILD=1
DO_SMOKE=1
HEALTH_URL="${HEALTH_URL:-https://nexuspci.com/health}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"

print_help() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull)    DO_PULL=0;  shift ;;
    --no-build)   DO_BUILD=0; shift ;;
    --skip-smoke) DO_SMOKE=0; shift ;;
    --health-url=*) HEALTH_URL="${1#*=}"; shift ;;
    -h|--help)    print_help; exit 0 ;;
    *) err "Unknown argument: $1"; print_help; exit 2 ;;
  esac
done

# ---------- locate repo root ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ ! -f docker-compose.yml ]; then
  err "docker-compose.yml not found in ${SCRIPT_DIR}"
  exit 1
fi

# ---------- detect docker compose binary ----------
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  err "Neither 'docker compose' nor 'docker-compose' is installed."
  exit 1
fi
log "Using compose binary: ${DC[*]}"

# ---------- preflight ----------
log "Preflight checks..."

if [ ! -f backend/.env ]; then
  err "backend/.env is missing. Copy backend/.env.example and configure it before deploying."
  exit 1
fi

# JWT_SECRET sanity check — refuse to deploy with the placeholder.
if grep -Eq '^JWT_SECRET=(replace[-_ ]?me|change[-_ ]?me|secret|dev[-_ ]?secret|)$' backend/.env; then
  err "backend/.env has a placeholder or empty JWT_SECRET. Set a real 32+ char secret before deploying."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  warn "curl is not installed; smoke test will be skipped."
  DO_SMOKE=0
fi

ok "Preflight passed"

# ---------- step 2: validate Caddyfile ----------
log "Validating Caddyfile syntax..."
caddy_running=0
if "${DC[@]}" ps --services --filter status=running 2>/dev/null | grep -qx caddy; then
  caddy_running=1
fi

if [ "${caddy_running}" = "1" ]; then
  "${DC[@]}" exec -T caddy caddy validate \
      --config /etc/caddy/Caddyfile --adapter caddyfile
else
  # Caddy isn't up yet — spin a throw-away container just to validate.
  docker run --rm \
    -v "${SCRIPT_DIR}/Caddyfile:/etc/caddy/Caddyfile:ro" \
    caddy:2-alpine \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
fi
ok "Caddyfile is valid"

# ---------- step 3: git pull ----------
if [ "${DO_PULL}" = "1" ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    log "git pull --ff-only"
    if ! git diff --quiet || ! git diff --cached --quiet; then
      warn "Working tree has uncommitted changes; will still attempt --ff-only pull"
    fi
    git fetch --prune
    git pull --ff-only
    ok "git pull complete (HEAD=$(git rev-parse --short HEAD))"
  else
    warn "Not a git checkout; skipping git pull"
  fi
else
  log "Skipping git pull (--no-pull)"
fi

# ---------- step 4: build images ----------
if [ "${DO_BUILD}" = "1" ]; then
  log "Building backend + frontend images (may take a few minutes)..."
  "${DC[@]}" build --pull backend frontend
  ok "Images built"
else
  log "Skipping build (--no-build)"
fi

# ---------- step 5: pull base images we don't build ----------
log "Pulling caddy base image..."
if ! "${DC[@]}" pull caddy; then
  warn "caddy pull failed; continuing with the cached image"
fi

# ---------- step 6: bring up the stack ----------
log "Starting / recreating services..."
"${DC[@]}" up -d --remove-orphans
ok "docker compose up -d complete"

# ---------- step 7: wait for backend healthcheck ----------
log "Waiting up to ${HEALTH_TIMEOUT_SEC}s for backend container to report healthy..."

backend_id=""
for _ in 1 2 3 4 5; do
  backend_id="$("${DC[@]}" ps -q backend || true)"
  [ -n "${backend_id}" ] && break
  sleep 1
done

if [ -z "${backend_id}" ]; then
  err "Could not find backend container ID after start."
  "${DC[@]}" ps
  exit 1
fi

deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
last_status=""
while :; do
  state="$(docker inspect --format '{{.State.Status}}' "${backend_id}" 2>/dev/null || echo missing)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${backend_id}" 2>/dev/null || echo none)"

  status="state=${state} health=${health}"
  if [ "${status}" != "${last_status}" ]; then
    log "Backend: ${status}"
    last_status="${status}"
  fi

  if [ "${state}" = "running" ] && [ "${health}" = "healthy" ]; then
    ok "Backend container is healthy"
    break
  fi

  if [ "${state}" = "exited" ] || [ "${state}" = "dead" ]; then
    err "Backend container is in state '${state}'. Last 80 log lines:"
    "${DC[@]}" logs --tail=80 backend || true
    exit 1
  fi

  if [ "$(date +%s)" -ge "${deadline}" ]; then
    err "Backend did not report healthy within ${HEALTH_TIMEOUT_SEC}s (last: ${status})."
    "${DC[@]}" logs --tail=120 backend || true
    exit 1
  fi

  sleep 3
done

# ---------- step 8: reload caddy with the new Caddyfile ----------
log "Reloading Caddy with the updated Caddyfile..."
if "${DC[@]}" exec -T caddy caddy reload \
     --config /etc/caddy/Caddyfile --adapter caddyfile; then
  ok "Caddy reloaded (no downtime)"
else
  warn "caddy reload failed; falling back to container restart"
  "${DC[@]}" restart caddy
  ok "Caddy restarted"
fi

# ---------- step 9: public smoke test ----------
if [ "${DO_SMOKE}" = "1" ]; then
  log "Smoke-testing public health endpoint: ${HEALTH_URL}"
  attempts=0
  max_attempts=10
  body_file="$(mktemp -t deploy-health.XXXXXX 2>/dev/null || echo /tmp/deploy-health.json)"
  while :; do
    attempts=$((attempts + 1))
    http_code="$(curl -fsS -o "${body_file}" -w '%{http_code}' --max-time 6 \
                   "${HEALTH_URL}" || echo 000)"
    if [ "${http_code}" = "200" ]; then
      ok "Public health endpoint OK (HTTP 200): $(head -c 200 "${body_file}")"
      break
    fi
    if [ "${attempts}" -ge "${max_attempts}" ]; then
      warn "Public health endpoint not reachable from this host (HTTP ${http_code} after ${attempts} tries)."
      warn "This is usually DNS / firewall on the deploy host, not a deploy failure."
      warn "Checking backend directly via the container instead..."
      if docker exec "${backend_id}" wget -qO- http://localhost:4000/health >/dev/null 2>&1; then
        ok "Backend /health responds inside the container — proxy or DNS is the issue, not the app."
      else
        err "Backend /health is also not responding inside the container."
        "${DC[@]}" logs --tail=80 backend || true
        exit 1
      fi
      break
    fi
    sleep 2
  done
  rm -f "${body_file}" 2>/dev/null || true
else
  log "Skipping public smoke test (--skip-smoke)"
fi

# ---------- summary ----------
echo
ok "${BOLD}Deploy complete.${NC}"
echo
"${DC[@]}" ps
