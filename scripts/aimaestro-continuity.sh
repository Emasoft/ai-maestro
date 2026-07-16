#!/usr/bin/env bash
# =============================================================================
# AI Maestro Continuity CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro agent-continuity API — the
# ONLY new script surface the Family-A continuity absorption adds (TRDD-DXJZM3BW,
# NPT of TRDD-KCRMSNL7). Plugins (the ai-maestro-tailored janitor `#J`) call THIS
# script, never the HTTP API directly (R23): the CLI here is immutable; the server
# API behind it may change freely.
#
# Two self-scoped verbs — a deliberate, minimal contract:
#   status <self>          the 5 continuity-status metadata fields for THIS host's
#                          account (account_healthy, window_5h_pct, window_7d_pct,
#                          cache_ttl_minutes, next_action). A DELIBERATE ceiling
#                          (TRDD-H24DF6ZC Constraint 1): no OAuth token can leak
#                          through the one verb an agent can call.
#   ensure-resume <self>   idempotently ensure THIS agent is resumed. If already
#                          live it is a no-op; otherwise the server resumes it via
#                          the existing wake path. The server owns the actuation.
#
# R42 self-only: <self> must resolve to the CALLER's own agent (its own AID). An
# agent may act ONLY on itself; the human owner may target any. Cross-agent
# liveness/actuation is the SERVER's job (TRDD-CHN16JXZ), never a call from here.
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# Everything else (waking, injecting) reuses aimaestro-session.sh.
#
# Usage:
#   aimaestro-continuity.sh status <self>
#   aimaestro-continuity.sh ensure-resume <self>
#
# <self> is the caller's own agent UUID, or a name/alias resolved via /api/agents?q=.
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

# Resolve an agent UUID from a UUID, name, or alias. Prints the UUID.
# (Same resolver the other frozen-layer scripts carry — self-contained by design.)
_resolve_agent_id() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent (UUID or name) required" >&2; return 1; }

    # Already a UUID — the API's own isValidUuid gate will reject a bad one.
    if [[ "$ref" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        printf '%s\n' "$ref"
        return 0
    fi

    # Reject anything that is not a plain tmux-safe name before it reaches a URL.
    if [[ ! "$ref" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "Error: invalid agent identifier '${ref}'" >&2
        return 1
    fi

    local encoded resp id
    encoded="$(printf '%s' "$ref" | jq -sRr @uri)"
    resp="$(_api GET "/api/agents?q=${encoded}")" || return 1
    id="$(printf '%s' "$resp" | jq -r '.agents[0].id // empty' 2>/dev/null)"
    if [ -z "$id" ]; then
        echo "Error: agent not found: ${ref}" >&2
        return 1
    fi
    printf '%s\n' "$id"
}

cmd_status() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent (self) required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api GET "/api/agents/${id}/continuity/status"
}

cmd_ensure_resume() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent (self) required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api POST "/api/agents/${id}/continuity/ensure-resume" '{}'
}

show_help() {
    cat <<'EOF'
aimaestro-continuity.sh — AI Maestro agent-continuity CLI

  status <self>          the 5 continuity-status fields for this host's account
                         (account_healthy, window_5h_pct, window_7d_pct,
                         cache_ttl_minutes, next_action) — metadata only, no token
  ensure-resume <self>   idempotently ensure THIS agent is resumed (no-op if live)

R42 self-only: <self> must be the CALLER's own agent. Agent callers export AID_AUTH.
EOF
}

case "${1:-help}" in
    status)        shift; cmd_status "$@" ;;
    ensure-resume) shift; cmd_ensure_resume "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-continuity.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
