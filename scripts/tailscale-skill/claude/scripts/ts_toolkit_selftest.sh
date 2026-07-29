#!/usr/bin/env bash
set -euo pipefail

# ts_toolkit_selftest.sh -- verifies the ts_catalog.sh / ts_call.sh toolkit
# against a throwaway fixture catalog. No network, no API key, no live tailnet:
# every check either resolves a request locally or asserts that a guard REFUSES.
#
#   ./ts_toolkit_selftest.sh
#
# Most cases here are NEGATIVE on purpose. A suite that only checks the happy
# path would still pass with the mutation gate deleted -- which is the one
# behaviour in this toolkit that must never regress. Each negative case asserts
# both a non-zero exit AND the specific message, so a guard that fails for an
# unrelated reason cannot masquerade as a pass.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(mktemp -d)"
CATALOG="$FIXTURE_DIR/operation_catalog.json"
PASS=0
FAIL=0

cleanup() { rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

# Prove the toolkit never reaches the network: with no key, any real request
# would fail in require_api_key. Every check below must pass regardless.
unset TS_API_KEY TAILSCALE_API_KEY || true
export TS_CATALOG="$CATALOG"
export TAILSCALE_ENV_FILE="$FIXTURE_DIR/no-such-env-file"

cat > "$CATALOG" <<'EOF'
[
  {
    "operationId": "deleteDevice",
    "method": "DELETE",
    "path": "/device/{deviceId}",
    "summary": "Delete a device from the tailnet",
    "tags": ["Devices"],
    "pathParams": [{"name": "deviceId", "required": true, "schema": {}}],
    "queryParams": [],
    "requestBodyRequired": false,
    "requestBodyContentTypes": [],
    "successCodes": ["200"]
  },
  {
    "operationId": "listTailnetDevices",
    "method": "GET",
    "path": "/tailnet/{tailnet}/devices",
    "summary": "List the devices in a tailnet",
    "tags": ["Devices"],
    "pathParams": [{"name": "tailnet", "required": true, "schema": {}}],
    "queryParams": [{"name": "fields", "required": false, "schema": {}}],
    "requestBodyRequired": false,
    "requestBodyContentTypes": [],
    "successCodes": ["200"]
  },
  {
    "operationId": "setPolicyFile",
    "method": "POST",
    "path": "/tailnet/{tailnet}/acl",
    "summary": "Set the tailnet policy file",
    "tags": ["PolicyFile"],
    "pathParams": [{"name": "tailnet", "required": true, "schema": {}}],
    "queryParams": [],
    "requestBodyRequired": true,
    "requestBodyContentTypes": ["application/json"],
    "successCodes": ["200"]
  },
  {
    "operationId": "validateAndTestPolicyFile",
    "method": "POST",
    "path": "/tailnet/{tailnet}/acl/validate",
    "summary": "Validate a policy file without applying it",
    "tags": ["PolicyFile"],
    "pathParams": [{"name": "tailnet", "required": true, "schema": {}}],
    "queryParams": [],
    "requestBodyRequired": true,
    "requestBodyContentTypes": ["application/json"],
    "successCodes": ["200"]
  }
]
EOF

ok()   { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }

# Asserts the command SUCCEEDS.
expect_ok() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label (expected success, got exit $?)"; fi
}

# Asserts the command FAILS *and* that stderr carries the expected phrase.
# Both halves matter: exit-non-zero alone would also be satisfied by a typo,
# a missing file, or an unrelated crash.
expect_refusal() {
  local label="$1" needle="$2"; shift 2
  local out rc
  set +e
  out="$("$@" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    bad "$label (expected refusal, but it SUCCEEDED)"
  elif ! printf '%s' "$out" | grep -qF "$needle"; then
    bad "$label (refused, but not for the expected reason; wanted: $needle)"
  else
    ok "$label"
  fi
}

echo "ts_catalog.sh"
# Positive control: the fixture really does contain matching rows, so a later
# "0 matched" result means a broken filter, not an empty catalog.
FOUND="$(bash "$SCRIPT_DIR/ts_catalog.sh" --search device --method GET --json | jq 'length')"
if [ "$FOUND" -ge 1 ]; then ok "search+method finds $FOUND op(s)"; else bad "search+method found nothing"; fi
TAGGED="$(bash "$SCRIPT_DIR/ts_catalog.sh" --tag PolicyFile --json | jq 'length')"
if [ "$TAGGED" -eq 2 ]; then ok "tag filter returns both PolicyFile ops"; else bad "tag filter returned $TAGGED, wanted 2"; fi
expect_ok "table output renders" bash "$SCRIPT_DIR/ts_catalog.sh" --search device
expect_refusal "missing catalog is a hard error, not an empty result" \
  "operation catalog not found" \
  env TS_CATALOG="$FIXTURE_DIR/absent.json" bash "$SCRIPT_DIR/ts_catalog.sh" --search device

echo "ts_call.sh -- resolution"
expect_ok "GET dry-run resolves" \
  bash "$SCRIPT_DIR/ts_call.sh" listTailnetDevices --params-json '{"tailnet":"acme.ts.net"}' --dry-run
expect_refusal "unknown operationId is caught before the network" \
  "unknown operationId" \
  bash "$SCRIPT_DIR/ts_call.sh" noSuchOperation --dry-run
expect_refusal "missing path param is caught before the network" \
  "missing required path param" \
  bash "$SCRIPT_DIR/ts_call.sh" listTailnetDevices --dry-run
expect_refusal "--body-json and --body-file are mutually exclusive" \
  "mutually exclusive" \
  bash "$SCRIPT_DIR/ts_call.sh" setPolicyFile --params-json '{"tailnet":"t"}' \
    --body-json '{}' --body-file /dev/null --yes
expect_refusal "a required body cannot be omitted" \
  "requires a request body" \
  bash "$SCRIPT_DIR/ts_call.sh" setPolicyFile --params-json '{"tailnet":"t"}' --yes
expect_refusal "non-object --params-json is rejected" \
  "must be a JSON object" \
  bash "$SCRIPT_DIR/ts_call.sh" listTailnetDevices --params-json '"acme"' --dry-run

# The path param is URL-encoded, so a value containing a slash or a space
# cannot smuggle an extra path segment into the request.
ENCODED="$(bash "$SCRIPT_DIR/ts_call.sh" listTailnetDevices --params-json '{"tailnet":"a b/c"}' --dry-run | grep -F 'url ')"
if printf '%s' "$ENCODED" | grep -qF 'a%20b%2Fc'; then ok "path params are URL-encoded"; else bad "path param not encoded: $ENCODED"; fi

echo "ts_call.sh -- the mutation gate"
expect_refusal "DELETE without --yes is refused" \
  "may mutate state; re-run with --yes" \
  bash "$SCRIPT_DIR/ts_call.sh" deleteDevice --params-json '{"deviceId":"d1"}'
expect_refusal "POST without --yes is refused" \
  "may mutate state; re-run with --yes" \
  bash "$SCRIPT_DIR/ts_call.sh" setPolicyFile --params-json '{"tailnet":"t"}' --body-json '{}'
# The documented edge case: read-only in EFFECT, POST in METHOD -- still gated,
# because the gate keys on the method and must not try to guess side effects.
expect_refusal "a read-only POST is still gated" \
  "may mutate state; re-run with --yes" \
  bash "$SCRIPT_DIR/ts_call.sh" validateAndTestPolicyFile --params-json '{"tailnet":"t"}' --body-json '{}'
expect_ok "--dry-run is always allowed, even for DELETE" \
  bash "$SCRIPT_DIR/ts_call.sh" deleteDevice --params-json '{"deviceId":"d1"}' --dry-run

echo "ts_smoke.sh"
expect_ok "the documented smoke test passes against the fixture" bash "$SCRIPT_DIR/ts_smoke.sh"

echo
printf 'passed %d, failed %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "OK: ts_call/ts_catalog toolkit self-test passed"
