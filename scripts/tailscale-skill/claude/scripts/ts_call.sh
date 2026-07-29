#!/usr/bin/env bash
set -euo pipefail

# ts_call.sh -- generic, catalog-driven Tailscale API request builder.
#
# ONE script for every operation instead of one script per endpoint: the
# catalog supplies the method, the path template and the required params;
# this script resolves them, validates BEFORE any network call, and executes
# only when explicitly allowed to.
#
#   ./ts_call.sh listTailnetDevices --params-json '{"tailnet":"acme.ts.net"}' --dry-run
#   ./ts_call.sh listTailnetDevices --params-json '{"tailnet":"acme.ts.net"}' --jq '.devices[] | {id,name,hostname,authorized}'
#   ./ts_call.sh deleteDevice       --params-json '{"deviceId":"device-id"}'  --dry-run
#   ./ts_call.sh deleteDevice       --params-json '{"deviceId":"device-id"}'  --yes
#   ./ts_call.sh setPolicyFile      --params-json '{"tailnet":"acme.ts.net"}' --body-file ./acl.hujson --yes
#
# SAFETY -- the two-step dry-run-then---yes mutation gate:
#   Any non-GET operation is REFUSED unless --yes is passed. --dry-run is
#   always allowed and never touches the network, so the safe workflow is
#   always: run with --dry-run, read what it would do, then re-run with --yes.
#
#   The gate keys on the HTTP METHOD, not on whether the endpoint actually
#   mutates anything. So a read-only POST -- validateAndTestPolicyFile, which
#   only validates an ACL -- is still gated. That is deliberate and must not
#   be "fixed": erring toward the gate costs one extra flag, while guessing
#   at a stranger's side effects costs a deleted device.
#
# Every validation failure happens BEFORE the request is built, so a typo in
# an operationId or a missing required param can never reach the network.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./ts_common.sh
. "$SCRIPT_DIR/ts_common.sh"

CATALOG="${TS_CATALOG:-$SCRIPT_DIR/../references/operation_catalog.json}"

OP_ID=""
PARAMS_JSON='{}'
QUERY_JSON='{}'
BODY_JSON=""
BODY_FILE=""
JQ_FILTER=""
RAW=0
DRY_RUN=0
YES=0
TMP_BODY=""

cleanup() { [ -n "$TMP_BODY" ] && [ -f "$TMP_BODY" ] && rm -f "$TMP_BODY"; return 0; }
trap cleanup EXIT

usage() {
  cat >&2 <<'EOF'
usage: ts_call.sh <operationId> [options]

  --params-json JSON   path-template params, e.g. '{"tailnet":"acme.ts.net"}'
  --query-json JSON    query-string params; null values are dropped
  --body-json JSON     request body, inline (mutually exclusive with --body-file)
  --body-file PATH     request body, from a file (mutually exclusive with --body-json)
  --jq FILTER          run the JSON response through this jq filter
  --raw                print the response body verbatim, no jq
  --dry-run            print the request that WOULD be sent; never uses the network
  --yes                permit a mutating (non-GET) operation to actually execute

Discover operationIds with:  ./ts_catalog.sh --search <term>
EOF
}

if [ $# -eq 0 ]; then usage; exit 2; fi

case "$1" in
  -h|--help) usage; exit 0 ;;
  --*) echo "error: first argument must be an operationId, got: $1" >&2; usage; exit 2 ;;
  *) OP_ID="$1"; shift ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --params-json) [ $# -ge 2 ] || { echo "error: --params-json needs a value" >&2; exit 2; }; PARAMS_JSON="$2"; shift 2 ;;
    --query-json)  [ $# -ge 2 ] || { echo "error: --query-json needs a value" >&2; exit 2; };  QUERY_JSON="$2";  shift 2 ;;
    --body-json)   [ $# -ge 2 ] || { echo "error: --body-json needs a value" >&2; exit 2; };   BODY_JSON="$2";   shift 2 ;;
    --body-file)   [ $# -ge 2 ] || { echo "error: --body-file needs a value" >&2; exit 2; };   BODY_FILE="$2";   shift 2 ;;
    --jq)          [ $# -ge 2 ] || { echo "error: --jq needs a value" >&2; exit 2; };          JQ_FILTER="$2";   shift 2 ;;
    --raw)      RAW=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --yes)      YES=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

require_cmd jq

if [ -n "$BODY_JSON" ] && [ -n "$BODY_FILE" ]; then
  echo "error: --body-json and --body-file are mutually exclusive" >&2
  exit 2
fi

if [ ! -f "$CATALOG" ]; then
  echo "error: operation catalog not found: $CATALOG" >&2
  echo "hint: generate it with  ./ts_build_catalog.sh /path/to/tailscale-openapi.json" >&2
  echo "      or point TS_CATALOG at an existing catalog file." >&2
  exit 1
fi

# Validated by direct call, not by eval-ing a variable name: this script builds
# URLs from user-supplied JSON, so it should not itself contain an eval that
# expands a name into a value.
require_json_object() {
  local label="$1"
  local value="$2"
  if ! printf '%s' "$value" | jq -e 'type == "object"' >/dev/null 2>&1; then
    echo "error: $label must be a JSON object, e.g. '{\"tailnet\":\"acme.ts.net\"}'" >&2
    exit 2
  fi
}
require_json_object --params-json "$PARAMS_JSON"
require_json_object --query-json "$QUERY_JSON"

OP="$(jq -c --arg id "$OP_ID" 'map(select(.operationId == $id)) | first // empty' "$CATALOG")"
if [ -z "$OP" ]; then
  echo "error: unknown operationId: $OP_ID" >&2
  echo "hint: find it with  ./ts_catalog.sh --search $(printf '%s' "$OP_ID" | cut -c1-12)" >&2
  exit 1
fi

METHOD="$(printf '%s' "$OP" | jq -r '.method')"
BODY_REQUIRED="$(printf '%s' "$OP" | jq -r '.requestBodyRequired // false')"

# --- validate BEFORE building the request -----------------------------------

MISSING_Q="$(
  jq -rn --argjson op "$OP" --argjson q "$QUERY_JSON" '
    [ ($op.queryParams // [])[]
      | select(.required == true)
      | select(($q[.name] // null) == null)
      | .name ] | join(", ")
  '
)"
if [ -n "$MISSING_Q" ]; then
  echo "error: $OP_ID is missing required query param(s): $MISSING_Q" >&2
  echo "hint: pass them with --query-json '{\"name\":\"value\"}'" >&2
  exit 1
fi

# Resolve {placeholders} from --params-json, URL-encoding each value.
URL_PATH="$(
  jq -rn --argjson op "$OP" --argjson params "$PARAMS_JSON" '
    reduce ($op.pathParams // [])[] as $pp ($op.path;
      ($params[$pp.name] // null) as $v
      | if $v == null then .
        else gsub("\\{" + $pp.name + "\\}"; ($v | tostring | @uri))
        end
    )
  '
)"

# Any surviving {placeholder} means a path param was not supplied. Checking the
# rendered path (rather than only the params marked required:true) also catches
# a spec that forgot to mark a path param required -- a path template can never
# be left half-resolved.
LEFTOVER="$(printf '%s' "$URL_PATH" | grep -oE '\{[^}]+\}' | tr -d '{}' | tr '\n' ' ' | sed 's/ $//' || true)"
if [ -n "$LEFTOVER" ]; then
  echo "error: $OP_ID is missing required path param(s): $LEFTOVER" >&2
  echo "hint: pass them with --params-json '{\"$(printf '%s' "$LEFTOVER" | cut -d' ' -f1)\":\"value\"}'" >&2
  exit 1
fi

if [ "$BODY_REQUIRED" = "true" ] && [ -z "$BODY_JSON" ] && [ -z "$BODY_FILE" ]; then
  echo "error: $OP_ID requires a request body; pass --body-json or --body-file" >&2
  exit 1
fi

if [ -n "$BODY_FILE" ] && [ ! -f "$BODY_FILE" ]; then
  echo "error: --body-file not found: $BODY_FILE" >&2
  exit 1
fi

# --- the mutation gate ------------------------------------------------------

if [ "$METHOD" != "GET" ] && [ "$DRY_RUN" -eq 0 ] && [ "$YES" -eq 0 ]; then
  echo "error: $OP_ID uses $METHOD and may mutate state; re-run with --yes after validating with --dry-run" >&2
  exit 1
fi

# --- build the URL ----------------------------------------------------------

QUERY_STRING="$(build_query_string "$QUERY_JSON")"
URL="${TS_API_BASE}${URL_PATH}"
[ -n "$QUERY_STRING" ] && URL="${URL}?${QUERY_STRING}"

EFFECTIVE_BODY_FILE=""
if [ -n "$BODY_JSON" ]; then
  TMP_BODY="$(json_tmp_file "$BODY_JSON")"
  EFFECTIVE_BODY_FILE="$TMP_BODY"
elif [ -n "$BODY_FILE" ]; then
  EFFECTIVE_BODY_FILE="$BODY_FILE"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN -- nothing was sent"
  echo "  operation : $OP_ID"
  echo "  method    : $METHOD"
  echo "  url       : $URL"
  if [ -n "$EFFECTIVE_BODY_FILE" ]; then
    echo "  body      : $EFFECTIVE_BODY_FILE"
    sed 's/^/            /' "$EFFECTIVE_BODY_FILE" | head -20
  else
    echo "  body      : (none)"
  fi
  if [ "$METHOD" != "GET" ]; then
    echo "  NOTE      : $METHOD is gated -- re-run with --yes to execute"
  fi
  exit 0
fi

# --- execute ----------------------------------------------------------------

RESPONSE="$(http_call "$METHOD" "$URL" "$EFFECTIVE_BODY_FILE")"

if [ "$RAW" -eq 1 ]; then
  printf '%s\n' "$RESPONSE"
elif [ -n "$JQ_FILTER" ]; then
  printf '%s' "$RESPONSE" | jq -r "$JQ_FILTER"
else
  printf '%s' "$RESPONSE" | jq .
fi
