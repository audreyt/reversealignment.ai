#!/bin/bash
# Full-stack join e2e: real browser → real Worker → D1 + R2.
#
# Boots an isolated `wrangler dev` (its own D1/R2 persist dir, its own .dev.vars,
# a free port) that serves the built dist alongside Worker routes, then runs
# tests/e2e/join-live.e2e.ts against it. Never touches the developer's
# .wrangler/state or .dev.vars.
#
# Env overrides (local / CI):
#   WRANGLER_BIN       wrangler executable (default: ./node_modules/.bin/wrangler)
#   WRANGLER_LOG_PATH  directory for wrangler logs (default: under the run dir)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

test -f dist/index.html || {
  echo "dist/index.html missing — run vp run build:en first" >&2
  exit 1
}
test -f dist/join/index.html || {
  echo "dist/join/index.html missing — English join page required" >&2
  exit 1
}
test -f tests/fixtures/portrait-halftone.webp || {
  echo "missing portrait fixture" >&2
  exit 1
}

WRANGLER_BIN="${WRANGLER_BIN:-./node_modules/.bin/wrangler}"
ADMIN_TOKEN="local-admin-token-for-live-e2e"

pick_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}
PORT="$(pick_port)"
BASE="http://127.0.0.1:${PORT}"

STAMP="$(date +%s)-$$"
RUN_DIR="${ROOT}/.tmp/join-live-${STAMP}"
PERSIST="${RUN_DIR}/wrangler-state"
ACCESS_DIR="${RUN_DIR}/access"
mkdir -p "$RUN_DIR/run" "$PERSIST" "$RUN_DIR/logs" "$ACCESS_DIR"

if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  if [[ -d "${ROOT}/.pw-browsers" ]]; then
    export PLAYWRIGHT_BROWSERS_PATH="${ROOT}/.pw-browsers"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    export PLAYWRIGHT_BROWSERS_PATH="${HOME}/Library/Caches/ms-playwright"
  else
    export PLAYWRIGHT_BROWSERS_PATH="${XDG_CACHE_HOME:-${HOME}/.cache}/ms-playwright"
  fi
fi
if [[ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]]; then
  echo "Playwright browser cache not found at ${PLAYWRIGHT_BROWSERS_PATH}; run 'vp exec playwright install chromium' first" >&2
  exit 1
fi

export TMPDIR="$RUN_DIR/tmp"
export XDG_CONFIG_HOME="$RUN_DIR/xdg"
export XDG_CACHE_HOME="$RUN_DIR/cache"
export XDG_DATA_HOME="$RUN_DIR/data"
export WRANGLER_HOME="$RUN_DIR/wrangler-home"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-$RUN_DIR/logs}"
mkdir -p "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$WRANGLER_HOME" \
  "$WRANGLER_LOG_PATH"

ACCESS_AUD="live-access-aud-${STAMP}"
ACCESS_ISSUER="https://erc.cloudflareaccess.com"
ACCESS_EMAIL="live-default@example.com"

node "$ROOT/scripts/access-jwt-fixture.mjs" bootstrap \
  --dir "$ACCESS_DIR" \
  --port 0 \
  --aud "$ACCESS_AUD" \
  --issuer "$ACCESS_ISSUER" \
  --email "$ACCESS_EMAIL" \
  >"$RUN_DIR/logs/access-bootstrap.log" 2>&1 &
ACCESS_PID=$!
for _ in $(seq 1 100); do
  if [[ -f "$ACCESS_DIR/meta.json" ]]; then break; fi
  if ! kill -0 "$ACCESS_PID" 2>/dev/null; then
    echo "access jwt fixture died" >&2
    cat "$RUN_DIR/logs/access-bootstrap.log" >&2 || true
    exit 1
  fi
  sleep 0.05
done
test -f "$ACCESS_DIR/meta.json" || {
  echo "access meta missing" >&2
  cat "$RUN_DIR/logs/access-bootstrap.log" >&2 || true
  exit 1
}
ACCESS_META="$(cat "$ACCESS_DIR/meta.json")"
ACCESS_JWKS_URL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["jwksUrl"])' "$ACCESS_META")"
ACCESS_JWT="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["token"])' "$ACCESS_META")"

cp wrangler.jsonc "$RUN_DIR/run/"
ln -sfn "$ROOT/worker" "$RUN_DIR/run/worker"
ln -sfn "$ROOT/src" "$RUN_DIR/run/src"
ln -sfn "$ROOT/dist" "$RUN_DIR/run/dist"
ln -sfn "$ROOT/node_modules" "$RUN_DIR/run/node_modules"
cat >"$RUN_DIR/run/.dev.vars" <<EOF
AUTH_PEPPER=local-live-e2e-pepper-not-for-production-32b
IMPORT_SALT=local-live-e2e-import-salt-not-for-production
ACCESS_AUD=${ACCESS_AUD}
ACCESS_ISSUER=${ACCESS_ISSUER}
ACCESS_JWKS_URL=${ACCESS_JWKS_URL}
JOIN_API_HOSTS=reversealignment.ai,reversealignment.tw,reversealignment.jp,127.0.0.1,localhost
ALLOWED_ORIGINS=${BASE},https://reversealignment.ai
ADMIN_TOKEN=${ADMIN_TOKEN}
EOF

DEV_PID=""
cleanup() {
  if [[ -n "${DEV_PID:-}" ]] && kill -0 "$DEV_PID" 2>/dev/null; then kill "$DEV_PID" 2>/dev/null || true; wait "$DEV_PID" 2>/dev/null || true; fi
  if [[ -n "${ACCESS_PID:-}" ]] && kill -0 "$ACCESS_PID" 2>/dev/null; then kill "$ACCESS_PID" 2>/dev/null || true; wait "$ACCESS_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

WRANGLER_ABS="$WRANGLER_BIN"
[[ "$WRANGLER_ABS" == /* ]] || WRANGLER_ABS="$ROOT/${WRANGLER_BIN#./}"

"$WRANGLER_ABS" d1 migrations apply reversealignment-coalition --local \
  --persist-to "$PERSIST" >"$RUN_DIR/logs/migrate.log" 2>&1 || {
  cat "$RUN_DIR/logs/migrate.log" >&2
  exit 1
}

(
  cd "$RUN_DIR/run"
  "$WRANGLER_ABS" dev --ip 127.0.0.1 --port "$PORT" --local --persist-to "$PERSIST" \
    --assets dist
) >"$RUN_DIR/logs/dev.log" 2>&1 &
DEV_PID=$!

for _ in $(seq 1 120); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "wrangler died" >&2
    tail -n 80 "$RUN_DIR/logs/dev.log" >&2 || true
    exit 1
  fi
  sleep 0.15
done
curl -sf "$BASE/api/health" >/dev/null || {
  echo "health never came up" >&2
  tail -n 80 "$RUN_DIR/logs/dev.log" >&2 || true
  exit 1
}

echo "live API ready on $BASE (isolated persist=$PERSIST)"

E2E_LIVE_API=1 \
E2E_BASE_URL="$BASE" \
E2E_ADMIN_TOKEN="$ADMIN_TOKEN" \
E2E_ACCESS_AUD="$ACCESS_AUD" \
E2E_ACCESS_ISSUER="$ACCESS_ISSUER" \
E2E_ACCESS_JWT="$ACCESS_JWT" \
E2E_ACCESS_KEY_FILE="$ACCESS_DIR/private.jwk" \
E2E_ACCESS_EMAIL="$ACCESS_EMAIL" \
  ./node_modules/.bin/vp exec playwright test tests/e2e/join-live.e2e.ts "$@"

echo "✓ live join e2e passed"
