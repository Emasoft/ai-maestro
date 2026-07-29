#!/usr/bin/env bash
set -euo pipefail

# ts_catalog.sh -- read-only discovery over the local operation catalog.
#
#   ./ts_catalog.sh --search device
#   ./ts_catalog.sh --tag DNS --method GET
#   ./ts_catalog.sh --json
#
# Filters combine with AND. --search is a case-insensitive substring match
# against operationId + path + summary, so you can find an operation without
# memorizing its id or re-reading the OpenAPI spec.
#
# Reads $TS_CATALOG, else ../references/operation_catalog.json (where
# ts_build_catalog.sh writes it). Never makes a network call and never needs
# an API key -- safe to run in any sandbox or CI job.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./ts_common.sh
. "$SCRIPT_DIR/ts_common.sh"

CATALOG="${TS_CATALOG:-$SCRIPT_DIR/../references/operation_catalog.json}"

TAG=""
METHOD=""
SEARCH=""
AS_JSON=0

usage() {
  cat >&2 <<'EOF'
usage: ts_catalog.sh [--search TERM] [--tag TAG] [--method METHOD] [--json]

  --search TERM    case-insensitive substring on operationId, path, summary
  --tag TAG        exact tag match, e.g. DNS, Devices, PolicyFile, Keys
  --method METHOD  HTTP method, e.g. GET, POST, DELETE (case-insensitive)
  --json           emit raw JSON entries instead of a table

Filters combine with AND. Read-only: no network, no API key.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --search)
      [ $# -ge 2 ] || { echo "error: --search needs a value" >&2; exit 2; }
      SEARCH="$2"; shift 2 ;;
    --tag)
      [ $# -ge 2 ] || { echo "error: --tag needs a value" >&2; exit 2; }
      TAG="$2"; shift 2 ;;
    --method)
      [ $# -ge 2 ] || { echo "error: --method needs a value" >&2; exit 2; }
      METHOD="$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')"; shift 2 ;;
    --json)    AS_JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

require_cmd jq

# A missing catalog is a "cannot run", not "nothing matched" -- say so and
# point at the generator, rather than printing an empty table that reads as
# a successful search with no results.
if [ ! -f "$CATALOG" ]; then
  echo "error: operation catalog not found: $CATALOG" >&2
  echo "hint: generate it with  ./ts_build_catalog.sh /path/to/tailscale-openapi.json" >&2
  echo "      or point TS_CATALOG at an existing catalog file." >&2
  exit 1
fi

FILTERED="$(
  jq --arg tag "$TAG" --arg method "$METHOD" --arg search "$SEARCH" '
    map(select(
          ($tag    == "" or (((.tags // []) | index($tag)) != null))
      and ($method == "" or (.method == $method))
      and ($search == "" or (
             ((.operationId // "") + " " + (.path // "") + " " + (.summary // ""))
             | ascii_downcase
             | contains($search | ascii_downcase)
           ))
    ))
  ' "$CATALOG"
)"

COUNT="$(printf '%s' "$FILTERED" | jq 'length')"

if [ "$AS_JSON" -eq 1 ]; then
  printf '%s\n' "$FILTERED"
  exit 0
fi

if [ "$COUNT" -eq 0 ]; then
  echo "no operations matched" >&2
  exit 0
fi

TABLE="$(
  printf '%s' "$FILTERED" | jq -r '
    (["METHOD","PATH","OPERATION","TAGS","SUMMARY"]),
    (.[] | [
       .method,
       .path,
       .operationId,
       ((.tags // []) | join("|")),
       ((.summary // "") | gsub("\t";" "))
     ])
    | @tsv
  '
)"

if command -v column >/dev/null 2>&1; then
  printf '%s\n' "$TABLE" | column -t -s "$(printf '\t')"
else
  printf '%s\n' "$TABLE"
fi
