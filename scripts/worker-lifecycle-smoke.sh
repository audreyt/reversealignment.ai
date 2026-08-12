#!/usr/bin/env bash
# Repeatable Worker+D1 lifecycle smoke for Access-gated multipart join.
# Isolated: never touches default .wrangler/state D1 or the developer's .dev.vars.
#
# Env overrides (local / CI):
#   WRANGLER_BIN       wrangler executable (default: ./node_modules/.bin/wrangler)
#   WRANGLER_LOG_PATH  directory for wrangler logs (default: under isolated SMOKE_DIR)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The Worker binds no static assets, so this needs no site build at all.

STAMP="$(date +%s)-$$"
SMOKE_DIR="${ROOT}/.tmp/worker-smoke-${STAMP}"
PERSIST="${SMOKE_DIR}/wrangler-state"
LOG="${SMOKE_DIR}/wrangler.log"
VARS="${SMOKE_DIR}/.dev.vars"
ACCESS_DIR="${SMOKE_DIR}/access"
mkdir -p "$PERSIST" "$SMOKE_DIR" "$ACCESS_DIR"

pick_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}
PORT="$(pick_port)"
BASE="http://127.0.0.1:${PORT}"
WRANGLER_BIN="${WRANGLER_BIN:-./node_modules/.bin/wrangler}"
WRANGLER=("$WRANGLER_BIN")

PORTRAIT_FIXTURE="${ROOT}/tests/fixtures/portrait-halftone.webp"
if [[ ! -f "$PORTRAIT_FIXTURE" ]]; then
  echo "missing portrait fixture $PORTRAIT_FIXTURE" >&2
  exit 1
fi
PORTRAIT_BYTES="$(wc -c <"$PORTRAIT_FIXTURE" | tr -d '[:space:]')"

DEV_VARS_BEFORE=""
if [[ -f .dev.vars ]]; then
  DEV_VARS_BEFORE="$(cksum .dev.vars | awk '{print $1" "$2}')"
fi
DEFAULT_D1_BEFORE=""
if [[ -d .wrangler/state/v3/d1 ]]; then
  DEFAULT_D1_BEFORE="$(find .wrangler/state/v3/d1 -type f -print0 | sort -z | xargs -0 cksum | cksum | awk '{print $1" "$2}')"
fi

ACCESS_AUD="smoke-access-aud-${STAMP}"
ACCESS_ISSUER="https://erc.cloudflareaccess.com"
ACCESS_EMAIL="lifecycle-probe@example.com"
ACCESS_PID=""

# Local JWKS + signed JWT (RS256). bootstrap keeps the JWKS server alive.
node "$ROOT/scripts/access-jwt-fixture.mjs" bootstrap \
  --dir "$ACCESS_DIR" \
  --port 0 \
  --aud "$ACCESS_AUD" \
  --issuer "$ACCESS_ISSUER" \
  --email "$ACCESS_EMAIL" \
  >"$SMOKE_DIR/access-bootstrap.log" 2>&1 &
ACCESS_PID=$!
for _ in $(seq 1 100); do
  if [[ -f "$ACCESS_DIR/meta.json" ]]; then break; fi
  if ! kill -0 "$ACCESS_PID" 2>/dev/null; then
    echo "access jwt fixture died" >&2
    cat "$SMOKE_DIR/access-bootstrap.log" >&2 || true
    exit 1
  fi
  sleep 0.05
done
test -f "$ACCESS_DIR/meta.json" || {
  echo "access meta missing" >&2
  cat "$SMOKE_DIR/access-bootstrap.log" >&2 || true
  exit 1
}
ACCESS_META="$(cat "$ACCESS_DIR/meta.json")"
ACCESS_JWKS_URL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["jwksUrl"])' "$ACCESS_META")"
ACCESS_JWT="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["token"])' "$ACCESS_META")"

PAGE_ORIGIN="https://pages.example"
# `wrangler dev` reports the bound address as the request hostname, so the local
# allowlist must contain it; the JOIN_API_HOSTS gate itself is unit-tested.
cat >"$VARS" <<EOF
AUTH_PEPPER=local-demo-pepper-not-for-production-32b
IMPORT_SALT=local-demo-import-salt-not-for-production
ACCESS_AUD=${ACCESS_AUD}
ACCESS_ISSUER=${ACCESS_ISSUER}
ACCESS_JWKS_URL=${ACCESS_JWKS_URL}
JOIN_API_HOSTS=reversealignment.ai,reversealignment.tw,reversealignment.jp,127.0.0.1
ALLOWED_ORIGINS=${BASE},${PAGE_ORIGIN},https://reversealignment.ai
ADMIN_TOKEN=local-admin-token-for-demo-only
EOF

export TMPDIR="${SMOKE_DIR}/tmp"
export XDG_CONFIG_HOME="${SMOKE_DIR}/xdg-config"
export XDG_CACHE_HOME="${SMOKE_DIR}/xdg-cache"
export XDG_STATE_HOME="${SMOKE_DIR}/xdg-state"
export WRANGLER_HOME="${SMOKE_DIR}/wrangler-home"
export WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-${SMOKE_DIR}/wrangler-logs}"
mkdir -p "$TMPDIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$WRANGLER_HOME" "$WRANGLER_LOG_PATH"

"${WRANGLER[@]}" d1 migrations apply reversealignment-coalition --local --persist-to "$PERSIST"

PID=""
cleanup() {
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  if [[ -n "${ACCESS_PID:-}" ]] && kill -0 "$ACCESS_PID" 2>/dev/null; then kill "$ACCESS_PID" 2>/dev/null || true; wait "$ACCESS_PID" 2>/dev/null || true; fi
  if [[ -n "$DEV_VARS_BEFORE" ]]; then
    NOW="$(cksum .dev.vars | awk '{print $1" "$2}')"
    test "$NOW" = "$DEV_VARS_BEFORE" || { echo "dev.vars mutated" >&2; exit 1; }
  fi
  if [[ -n "$DEFAULT_D1_BEFORE" ]]; then
    NOW="$(find .wrangler/state/v3/d1 -type f -print0 | sort -z | xargs -0 cksum | cksum | awk '{print $1" "$2}')"
    test "$NOW" = "$DEFAULT_D1_BEFORE" || { echo "default d1 mutated" >&2; exit 1; }
  fi
}
trap cleanup EXIT

RUN_DIR="${SMOKE_DIR}/run"
mkdir -p "$RUN_DIR"
cp wrangler.jsonc "$RUN_DIR/"
cp worker-configuration.d.ts "$RUN_DIR/" 2>/dev/null || true
ln -s "$ROOT/worker" "$RUN_DIR/worker"
ln -s "$ROOT/dist" "$RUN_DIR/dist"
ln -s "$ROOT/node_modules" "$RUN_DIR/node_modules"
ln -s "$ROOT/src" "$RUN_DIR/src"
cp "$VARS" "$RUN_DIR/.dev.vars"

(
  cd "$RUN_DIR"
  "${WRANGLER[@]}" dev --ip 127.0.0.1 --port "$PORT" --local --persist-to "$PERSIST" \
    >"$LOG" 2>&1
) &
PID=$!

for i in $(seq 1 100); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "wrangler died" >&2
    tail -n 80 "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.15
done
curl -sf "$BASE/api/health" >/dev/null || {
  echo "health never came up" >&2
  tail -n 80 "$LOG" >&2 || true
  exit 1
}

auth_hdr=(-H "Cf-Access-Jwt-Assertion: ${ACCESS_JWT}")

# join_ip allows 8 submits per hour, and this script makes more than that. Give
# each case its own TEST-NET-3 client IP so the limit stays a tested contract
# (see the rate-limit case at the end) instead of an ordering accident.
#
# The counter lives in a file because every call site is `$(syn_ip)`, which runs
# in a subshell: a shell variable would be incremented in the child and lost,
# handing every request the same address.
SYN_IP_FILE="$SMOKE_DIR/syn-ip.counter"
echo 0 >"$SYN_IP_FILE"
syn_ip() {
  local n
  n=$(($(cat "$SYN_IP_FILE") + 1))
  echo "$n" >"$SYN_IP_FILE"
  printf '203.0.113.%d' "$n"
}

# `set -e` on a bare `test` hides the observed value, which is the only thing
# worth knowing when an HTTP contract regresses.
expect_status() {
  local label="$1" want="$2" got="$3" body="${4:-}"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL ${label}: expected HTTP ${want}, got ${got}" >&2
    [[ -n "$body" && -f "$body" ]] && head -c 400 "$body" >&2 && echo >&2
    exit 1
  fi
}

echo "== health =="
curl -sf "$BASE/api/health" | grep -q '"ok":true'

echo "== published canonical seed (public, no JWT) =="
BASELINE_TOTAL=$(curl -sf "$BASE/api/members" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
CANONICAL_TOTAL=$(curl -sf "$BASE/api/members?source=canonical&limit=100" | python3 -c 'import sys,json; data=json.load(sys.stdin); assert all(member.get("source") == "canonical" for member in data.get("members", [])), data; print(data["total"])')
test "$CANONICAL_TOTAL" = "25"
test "$BASELINE_TOTAL" = "$CANONICAL_TOTAL"

echo "== Tenzin portrait key =="
curl -sf "$BASE/api/members?q=Tenzin" | python3 -c '
import sys, json
data = json.load(sys.stdin)
members = data.get("members") or []
tenzin = next((m for m in members if m.get("id") == "canonical:person-tenzin-yangtso"), None)
assert tenzin is not None, members
assert tenzin.get("role") == "Researcher, Civic.AI", tenzin
assert tenzin.get("imageKey") == "person-tenzin-yangtso", tenzin
print("tenzin ok", tenzin.get("imageKey"))
'

echo "== imported email hash returns already_recorded =="
IMPORT_EMAIL="import-returner@example.com"
IMPORT_ID="mbr_imp_smoke_returner"
IMPORT_SALT_SMOKE="local-demo-import-salt-not-for-production"
IMPORT_HASH=$(node -e 'const {createHash}=require("node:crypto"); const salt=process.argv[1]; const email=process.argv[2].trim().toLowerCase(); process.stdout.write("import:"+createHash("sha256").update(salt+"\n"+email).digest("hex"));' "$IMPORT_SALT_SMOKE" "$IMPORT_EMAIL")
"${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "INSERT OR REPLACE INTO members (
    id, email_hash, email_domain, full_name, name_key, affiliation, role, sector, contribution,
    links, statement, image_key, source, status, sort_index,
    moderation_score, moderation_notes, moderation_model, moderation_recommendation,
    created_at, updated_at, published_at, verified_at
  ) VALUES (
    '${IMPORT_ID}', '${IMPORT_HASH}', '', 'Import Returner', 'import returner', 'Smoke Lab', 'Smoke Lab', 'Research', '',
    '', '', NULL, 'community', 'published', 1999,
    1.0, 'smoke_import_hash', 'import', 'allow',
    '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z'
  )" >/dev/null
IMPORT_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$IMPORT_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
IMPORT_JOIN_STATUS=$(curl -s -o "$SMOKE_DIR/import-return.json" -w '%{http_code}' -X POST "$BASE/join/api" \
  -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${IMPORT_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Import Returner' -F 'sector=Research')
expect_status 'import returner join' 200 "$IMPORT_JOIN_STATUS" "$SMOKE_DIR/import-return.json"
python3 - "$SMOKE_DIR/import-return.json" "$IMPORT_ID" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
assert data.get('ok') is True, data
assert data.get('status') == 'already_recorded', data
assert data.get('memberId') == sys.argv[2], data
print('import returner already_recorded ok')
PY
IMPORT_ROW=$("${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "SELECT COUNT(*) AS n, MAX(email) AS email, MAX(email_domain) AS email_domain
             FROM members
             WHERE full_name='Import Returner' OR email_hash='${IMPORT_HASH}' OR id='${IMPORT_ID}'" \
  | python3 -c '
import sys, json
rows = json.load(sys.stdin)
flat = []
if isinstance(rows, list):
  for block in rows:
    flat.extend(block.get("results") or [])
elif isinstance(rows, dict):
  flat.extend(rows.get("results") or [])
row = flat[0] if flat else {}
print("{}|{}|{}".format(row.get("n", "missing"), row.get("email", ""), row.get("email_domain", "")))
')
test "$IMPORT_ROW" = "1|$IMPORT_EMAIL|example.com"
"${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "DELETE FROM members WHERE id='${IMPORT_ID}'" >/dev/null
TOTAL=$(curl -sf "$BASE/api/members" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
test "$TOTAL" = "$BASELINE_TOTAL"

echo "== join missing JWT =="
MISS=$(curl -s -o "$SMOKE_DIR/miss.json" -w '%{http_code}' -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Origin: $BASE" -F 'fullName=No Auth' -F 'sector=Research')
test "$MISS" = "401"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error") in ("access_required","access_not_configured"), d' "$SMOKE_DIR/miss.json"

echo "== join invalid JWT =="
BAD=$(curl -s -o "$SMOKE_DIR/badjwt.json" -w '%{http_code}' -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Origin: $BASE" -H 'Cf-Access-Jwt-Assertion: not.a.jwt' \
  -F 'fullName=Bad Jwt' -F 'sector=Research')
test "$BAD" = "401"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error")=="access_required", d' "$SMOKE_DIR/badjwt.json"
# The JOIN_API_HOSTS gate cannot be exercised over HTTP here: `wrangler dev`
# builds request.url from the bound address, so neither a spoofed `Host:` header
# nor connecting via `localhost` changes what the Worker sees. Host routing is
# covered by tests/unit/worker-routing.test.ts against the real fetch handler.

echo "== legacy /en/join/api path 404 even with JWT =="
LEG=$(curl -s -o "$SMOKE_DIR/leg.json" -w '%{http_code}' -X POST "$BASE/en/join/api" \
  "${auth_hdr[@]}" -H "Origin: $BASE" -F 'fullName=Legacy' -F 'sector=Research')
test "$LEG" = "404"

echo "== join multipart with portrait (directory intent) =="
JOIN=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  "${auth_hdr[@]}" -H "Origin: $BASE" \
  -F 'fullName=Lifecycle Probe' \
  -F 'affiliation=Ephemeral QA Fixture' \
  -F 'sector=Research' \
  -F 'contribution=Lend your name to the statement' \
  -F 'links=' \
  -F 'statement=lifecycle' \
  -F 'website=' \
  -F "portrait=@${PORTRAIT_FIXTURE};type=image/webp")
python3 - <<PY
import json,sys
d=json.loads('''$JOIN''')
assert d.get("ok") is True, d
assert d.get("status")=="pending_review", d
assert "after moderation" in str(d.get("message","")).lower(), d
assert d.get("portraitStored") is True, d
assert str(d.get("memberId","")).startswith("mbr_"), d
print("join ok", d["memberId"])
PY
MEMBER_ID=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["memberId"])' "$JOIN")
test -n "$MEMBER_ID"

echo "== updates-only join stays out of the moderation queue =="
UPD_EMAIL="updates-only-${STAMP}@example.com"
UPD_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$UPD_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
UPD=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${UPD_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Updates Only Probe' \
  -F 'sector=Research' \
  -F 'contribution=Stay informed as the coalition grows')
python3 - <<PY
import json
d=json.loads('''$UPD''')
assert d.get("ok") is True, d
assert d.get("status")=="updates_only", d
assert "does not place" in str(d.get("message","")).lower(), d
assert str(d.get("memberId","")).startswith("mbr_"), d
print("updates-only ok", d["memberId"])
PY
UPD_ID=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["memberId"])' "$UPD")
UPD_STATUS=$("${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "SELECT status, contribution, email, email_domain FROM members WHERE id='${UPD_ID}'" \
  | python3 -c '
import sys, json
rows = json.load(sys.stdin)
flat = []
if isinstance(rows, list):
  for block in rows:
    flat.extend(block.get("results") or [])
elif isinstance(rows, dict):
  flat.extend(rows.get("results") or [])
assert flat and flat[0]["status"] == "updates_only", flat
assert flat[0]["contribution"] == "Stay informed as the coalition grows", flat
assert flat[0]["email"] == sys.argv[1], flat
assert flat[0]["email_domain"] == "example.com", flat
print(flat[0]["status"])
' "$UPD_EMAIL")
test "$UPD_STATUS" = "updates_only"
curl -sf -H 'X-Admin-Token: local-admin-token-for-demo-only' "$BASE/api/admin/queue" \
  | python3 -c '
import sys, json
data = json.load(sys.stdin)
rows = data.get("members") or []
member = next((row for row in rows if row.get("id") == sys.argv[1]), None)
assert member and member.get("email") == sys.argv[3], rows
assert all(row.get("id") != sys.argv[2] for row in rows), rows
print("queue excludes updates-only and includes private email")
' "$MEMBER_ID" "$UPD_ID" "$ACCESS_EMAIL"

echo "== body email is ignored (JWT email wins) =="
SPOOF=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  "${auth_hdr[@]}" -H "Origin: $BASE" \
  -F 'fullName=Spoof Attempt' -F 'sector=Research' \
  -F 'email=attacker@evil.example')
python3 - <<PY
import json
d=json.loads('''$SPOOF''')
assert d.get("ok") is True and d.get("status")=="already_recorded", d
assert d.get("memberId")=="$MEMBER_ID", d
print("body email ignored; JWT member reused")
PY

echo "== portrait durable image_key + verified email =="
IMAGE_KEY=$("${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "SELECT image_key, email, email_domain FROM members WHERE id='${MEMBER_ID}'" \
  | python3 -c '
import sys, json
rows = json.load(sys.stdin)
flat = []
if isinstance(rows, list):
  for block in rows:
    flat.extend(block.get("results") or [])
elif isinstance(rows, dict):
  flat.extend(rows.get("results") or [])
assert flat, rows
row = flat[0]
assert row.get("email") == sys.argv[1], row
assert row.get("email_domain") == "example.com", row
key = row.get("image_key")
assert key and __import__("re").match(r"^portraits/[0-9a-f]{64}\.webp$", key), key
print(key)
' "$ACCESS_EMAIL")
PORTRAIT_SEG="${IMAGE_KEY#portraits/}"
echo "image_key ok $IMAGE_KEY"

echo "== portrait GET bytes =="
curl -sD "$SMOKE_DIR/portrait.hdr" -o "$SMOKE_DIR/got.webp" "$BASE/api/portrait/${PORTRAIT_SEG}"
HTTP_P=$(awk 'BEGIN{RS="\r\n"} NR==1{print $2; exit}' "$SMOKE_DIR/portrait.hdr")
test "$HTTP_P" = "200"
grep -qiE '^content-type:[[:space:]]*image/webp' "$SMOKE_DIR/portrait.hdr"
grep -qiE '^cache-control:.*immutable' "$SMOKE_DIR/portrait.hdr"
cmp "$PORTRAIT_FIXTURE" "$SMOKE_DIR/got.webp"

echo "== portrait GET missing / traversal =="
P404A=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/portrait/deadbeef.webp")
test "$P404A" = "404"
P404B=$(curl --path-as-is -s -o /dev/null -w '%{http_code}' "$BASE/api/portrait/../secret")
test "$P404B" = "404"

echo "== portrait unsupported type =="
BAD_EMAIL="portrait-shape@example.com"
BAD_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$BAD_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
PC_BAD=$(curl -s -o "$SMOKE_DIR/p-bad.json" -w '%{http_code}' -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${BAD_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Bad Photo' -F 'sector=Research' \
  -F "portrait=@-;filename=x.webp;type=image/webp" <<<'not an image')
test "$PC_BAD" = "415"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error")=="portrait_unsupported_type", d' "$SMOKE_DIR/p-bad.json"

echo "== portrait payload too large =="
head -c 200000 /dev/zero | tr '\0' 'A' >"$SMOKE_DIR/p-big.bin"
BIG_EMAIL="portrait-big@example.com"
BIG_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$BIG_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
PC_BIG=$(curl -s -o "$SMOKE_DIR/p-big.json" -w '%{http_code}' -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${BIG_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Big Photo' -F 'sector=Research' \
  -F "portrait=@${SMOKE_DIR}/p-big.bin;filename=x.webp;type=image/webp")
test "$PC_BIG" = "413"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error")=="payload_too_large", d' "$SMOKE_DIR/p-big.json"

echo "== honeypot no write (mirrors directory intent status) =="
HP_EMAIL="honeypot@example.com"
HP_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$HP_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
HP=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${HP_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Bot' -F 'sector=Research' \
  -F 'contribution=Lend your name to the statement' \
  -F 'website=http://x')
python3 - <<PY
import json
d=json.loads('''$HP''')
assert d.get("ok") is True and d.get("status")=="pending_review", d
assert "after moderation" in str(d.get("message","")).lower(), d
assert "memberId" not in d, d
PY
HP_UPD=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${HP_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Bot Updates' -F 'sector=Research' \
  -F 'contribution=Stay informed as the coalition grows' \
  -F 'website=http://x')
python3 - <<PY
import json
d=json.loads('''$HP_UPD''')
assert d.get("ok") is True and d.get("status")=="updates_only", d
assert "does not place" in str(d.get("message","")).lower(), d
assert "memberId" not in d, d
PY
HP_COUNT=$("${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "SELECT COUNT(*) AS n FROM members WHERE full_name='Bot'" \
  | python3 -c '
import sys,json
rows=json.load(sys.stdin)
flat=[]
if isinstance(rows,list):
  for b in rows: flat.extend(b.get("results") or [])
elif isinstance(rows,dict): flat.extend(rows.get("results") or [])
print(flat[0]["n"] if flat else "missing")
')
test "$HP_COUNT" = "0"

echo "== duplicate already_recorded (same Access email) =="
JOIN2=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  "${auth_hdr[@]}" -H "Origin: $BASE" \
  -F 'fullName=Lifecycle Probe Alt' -F 'sector=Research')
python3 - <<PY
import json
d=json.loads('''$JOIN2''')
assert d.get("ok") is True and d.get("status")=="already_recorded", d
assert d.get("memberId")=="$MEMBER_ID", d
PY

echo "== still at published baseline before admin publish =="
TOTAL=$(curl -sf "$BASE/api/members" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
test "$TOTAL" = "$BASELINE_TOTAL"

echo "== admin publish =="
ID=$(curl -sf -H 'X-Admin-Token: local-admin-token-for-demo-only' "$BASE/api/admin/queue" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["members"][0]["id"])')
test "$ID" = "$MEMBER_ID"
curl -sf -X POST -H 'X-Admin-Token: local-admin-token-for-demo-only' \
  -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID\",\"action\":\"publish\"}" \
  "$BASE/api/admin/members" | grep -q '"ok":true'
TOTAL=$(curl -sf "$BASE/api/members" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
test "$TOTAL" = "$((BASELINE_TOTAL + 1))"
COMM=$(curl -sf "$BASE/api/members?source=community" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
test "$COMM" = "$((TOTAL - BASELINE_TOTAL))"

echo "== published member portrait fields =="
curl -sf "$BASE/api/members?source=community&limit=100&q=Lifecycle" | python3 -c '
import sys, json
data = json.load(sys.stdin)
members = data.get("members") or []
m = next((row for row in members if row.get("id") == "'"$MEMBER_ID"'"), None)
assert m is not None, members[:3]
assert m.get("avatar") == "photo", m
assert m.get("imageKey") == "'"$IMAGE_KEY"'", m
assert m.get("portraitUrl") == "/api/portrait/'"$PORTRAIT_SEG"'", m
assert "email" not in m, m
print("published portrait ok", m.get("portraitUrl"))
'

echo "== name collision =="
COLL_EMAIL="lifecycle-probe-2@example.com"
COLL_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$COLL_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
JOIN3=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${COLL_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Lifecycle Probe' -F 'sector=Research' \
  -F 'contribution=All of the above')
ID2=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["memberId"])' "$JOIN3")
COLL=$(curl -s -o "$SMOKE_DIR/coll.json" -w '%{http_code}' -X POST \
  -H 'X-Admin-Token: local-admin-token-for-demo-only' -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID2\",\"action\":\"publish\"}" "$BASE/api/admin/members")
test "$COLL" = "409"

echo "== rejected re-join already_recorded =="
curl -sf -X POST -H 'X-Admin-Token: local-admin-token-for-demo-only' -H 'Content-Type: application/json' \
  -d "{\"id\":\"$ID2\",\"action\":\"reject\"}" "$BASE/api/admin/members" >/dev/null
JOIN4=$(curl -sf -X POST "$BASE/join/api" -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${COLL_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Lifecycle Probe' -F 'sector=Research')
python3 - <<PY
import json
d=json.loads('''$JOIN4''')
assert d.get("status")=="already_recorded", d
PY

echo "== bad admin =="
BAD_A=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Admin-Token: wrong' "$BASE/api/admin/queue")
test "$BAD_A" = "401"

echo "== join without photo (monogram, directory intent) =="
MONO_EMAIL="mono-probe@example.com"
MONO_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
  --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "$MONO_EMAIL" \
  --key-file "$ACCESS_DIR/private.jwk")"
MONO_STATUS=$(curl -s -o "$SMOKE_DIR/mono.json" -w '%{http_code}' -X POST "$BASE/join/api" \
  -H "CF-Connecting-IP: $(syn_ip)" \
  -H "Cf-Access-Jwt-Assertion: ${MONO_JWT}" -H "Origin: $BASE" \
  -F 'fullName=Mono Probe' -F 'sector=Media' \
  -F 'contribution=Lend your name to the statement')
expect_status 'monogram join' 200 "$MONO_STATUS" "$SMOKE_DIR/mono.json"
MONO=$(cat "$SMOKE_DIR/mono.json")
python3 - <<PY
import json
d=json.loads('''$MONO''')
assert d.get("ok") is True and d.get("status")=="pending_review", d
assert "portraitStored" not in d, d
assert str(d.get("memberId","")).startswith("mbr_"), d
PY

echo "== join_ip rate limit refuses the 9th submit from one IP =="
# Every case above uses its own IP; pin the limit itself with a fixed one.
RL_IP="203.0.113.240"
RL_STATUS=""
for i in $(seq 1 9); do
  RL_JWT="$(node "$ROOT/scripts/access-jwt-fixture.mjs" sign \
    --aud "$ACCESS_AUD" --issuer "$ACCESS_ISSUER" --email "rl-${i}-${STAMP}@example.com" \
    --key-file "$ACCESS_DIR/private.jwk")"
  RL_STATUS=$(curl -s -o "$SMOKE_DIR/rl.json" -w '%{http_code}' -X POST "$BASE/join/api" \
    -H "CF-Connecting-IP: ${RL_IP}" -H "Cf-Access-Jwt-Assertion: ${RL_JWT}" \
    -H "Origin: $BASE" -F "fullName=Rate Probe ${i}" -F 'sector=Research')
  if [[ "$i" -le 8 ]]; then
    expect_status "rate probe ${i}" 200 "$RL_STATUS" "$SMOKE_DIR/rl.json"
  fi
done
expect_status 'rate probe 9' 429 "$RL_STATUS" "$SMOKE_DIR/rl.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error")=="rate_limited" and d.get("retryAfter"), d' "$SMOKE_DIR/rl.json"

echo "== no join_challenges table =="
"${WRANGLER[@]}" d1 execute reversealignment-coalition --local --persist-to "$PERSIST" --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='join_challenges'" \
  | python3 -c '
import sys, json
rows = json.load(sys.stdin)
flat = []
if isinstance(rows, list):
  for block in rows:
    flat.extend(block.get("results") or [])
elif isinstance(rows, dict):
  flat.extend(rows.get("results") or [])
assert not flat, flat
print("join_challenges absent")
'

echo "✓ worker lifecycle smoke passed (isolated persist=$PERSIST)"
