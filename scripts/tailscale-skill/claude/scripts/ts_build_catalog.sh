#!/usr/bin/env bash
set -euo pipefail

# Regenerate references/operation_catalog.json and references/operations.tsv
# from a Tailscale OpenAPI spec.
#
# Usage:
#   ts_build_catalog.sh [/path/to/tailscale-api.json]
#
# Download the spec from:
#   https://github.com/tailscale/tailscale/blob/main/api.md
# or fetch it directly:
#   curl -o tailscale-api.json https://raw.githubusercontent.com/tailscale/tailscale/main/api.md
# (look for the openapi spec link in the Tailscale API docs)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF_DIR="$SCRIPT_DIR/../references"
SPEC_PATH="${1:-$REF_DIR/tailscale-api.json}"

if [[ ! -f "$SPEC_PATH" ]]; then
  echo "error: OpenAPI spec not found: $SPEC_PATH" >&2
  echo "Usage: ts_build_catalog.sh [/path/to/tailscale-api.json]" >&2
  exit 1
fi

jq '
  . as $root |
  def deref_param($p):
    if ($p["$ref"]? != null) then
      ($p["$ref"] | split("/") | last) as $name
      | ($root.components.parameters[$name] // $p)
    else
      $p
    end;
  [
    .paths
    | to_entries[]
    | .key as $path
    | .value as $pathItem
    | $pathItem
    | to_entries[]
    | select(.key|IN("get","post","put","patch","delete"))
    | . as $op
    | ((($pathItem.parameters // []) + ($op.value.parameters // [])) | map(deref_param(.))) as $params
    | {
        operationId: ($op.value.operationId // ("op_" + ($path|gsub("[^A-Za-z0-9]";"_")) + "_" + $op.key)),
        method: ($op.key | ascii_upcase),
        path: $path,
        summary: ($op.value.summary // ""),
        tags: ($op.value.tags // []),
        pathParams: [$params[] | select(.in=="path") | {name, required: (.required // false), schema: (.schema // {})}],
        queryParams: [$params[] | select(.in=="query") | {name, required: (.required // false), schema: (.schema // {})}],
        requestBodyRequired: ($op.value.requestBody.required // false),
        requestBodyContentTypes: (($op.value.requestBody.content // {}) | keys),
        successCodes: (($op.value.responses // {}) | keys | map(select(test("^2"))))
      }
  ]
  | sort_by(.operationId)
' "$SPEC_PATH" > "$REF_DIR/operation_catalog.json"

jq -r '
  .paths as $p |
  ["idx","method","path","operationId","tags","summary"] ,
  (
    [ $p | to_entries[] | .key as $path | .value | to_entries[] | select(.key|IN("get","post","put","patch","delete")) | {method:(.key|ascii_upcase), path:$path, op:(.value.operationId // ""), tags:((.value.tags // [])|join("|")), summary:(.value.summary // "")} ]
    | to_entries[]
    | [(.key+1), .value.method, .value.path, .value.op, .value.tags, .value.summary]
  )
  | @tsv
' "$SPEC_PATH" > "$REF_DIR/operations.tsv"

echo "Wrote: $REF_DIR/operation_catalog.json"
echo "Wrote: $REF_DIR/operations.tsv"
