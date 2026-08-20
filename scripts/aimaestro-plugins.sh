#!/usr/bin/env bash
# =============================================================================
# AI Maestro plugins CLI (TRDD-MNN0VAS6)
# =============================================================================
#
# Read-side companion to the server's fleet-plugins-update lane. Plugins (the
# janitor) call THIS script, never the HTTP API directly.
#
# Usage:
#   aimaestro-plugins.sh update-trail [--limit N] [--target <pluginId>] [--json]
#       The per-invocation `claude plugin update` trail: one row per invocation,
#       newest first — {target, scope, project, start_epoch, end_epoch, ok,
#       detail, by}. This is what lets an interrupted cache extraction be
#       attributed to the exact fire that caused it; the last-run stamp alone
#       cannot see earlier fires. Default output is TSV
#       (target<TAB>ok<TAB>start_epoch<TAB>end_epoch<TAB>detail); --json prints
#       the raw rows. --limit caps rows (default 50, max 500). Exit: 0 with rows
#       (possibly zero — an empty trail is a legal fresh state, NOT an error);
#       non-zero only on transport/auth/HTTP failure.
#
# Auth: agents export AID_AUTH (Bearer); the human/UI path uses the aim_session
# cookie. Read-only — no strict token ever needed.
#
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/shell-helpers/common.sh" ]; then
    source "${SCRIPT_DIR}/shell-helpers/common.sh"
elif [ -f "${HOME}/.local/share/aimaestro/shell-helpers/common.sh" ]; then
    source "${HOME}/.local/share/aimaestro/shell-helpers/common.sh"
else
    echo "Error: cannot locate shell-helpers/common.sh" >&2
    exit 1
fi

check_jq || exit 1

cmd_update_trail() {
    local limit=50 target="" as_json=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --limit)  limit="$2"; shift 2 ;;
            --target) target="$2"; shift 2 ;;
            --json)   as_json=1; shift ;;
            *) echo "Error: unknown flag for 'update-trail': $1" >&2; return 1 ;;
        esac
    done
    local qs="limit=${limit}"
    if [ -n "$target" ]; then
        qs="${qs}&target=$(printf '%s' "$target" | jq -sRr @uri)"
    fi
    local out
    out="$(api_query GET "/api/plugins/update-trail?${qs}")" || return 1
    # `.rows // []`: an auth/error body has no rows array, and a bare `.rows[]`
    # would exit 5 with a jq iterate-null error — an instrument failure reading
    # as data (the PROBE_FAILED lesson). api_query already surfaced the HTTP
    # error; here we only guard the parse.
    if [ "$as_json" = 1 ]; then
        printf '%s\n' "$out" | jq '.rows // []'
    else
        printf '%s\n' "$out" | jq -r '(.rows // [])[] | [.target, (.ok|tostring), (.start_epoch|tostring), (.end_epoch|tostring), .detail] | @tsv'
    fi
}

case "${1:-help}" in
    update-trail) shift; cmd_update_trail "$@" ;;
    help|--help|-h) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
    --version|-v) echo "aimaestro-plugins.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; exit 1 ;;
esac
