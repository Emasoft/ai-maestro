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
# Three self-scoped verbs — a deliberate, minimal contract:
#   status <self>          the 5 continuity-status metadata fields for THIS host's
#                          account (account_healthy, window_5h_pct, window_7d_pct,
#                          cache_ttl_minutes, next_action). A DELIBERATE ceiling
#                          (TRDD-H24DF6ZC Constraint 1): no OAuth token can leak
#                          through the one verb an agent can call.
#   ensure-resume <self>   idempotently ensure THIS agent is resumed. If already
#                          live it is a no-op; otherwise the server resumes it via
#                          the existing wake path. The server owns the actuation.
#   restart-self [--force] restart THIS agent's OWN tmux session (stop the client,
#                          wait for the shell, relaunch with the stored persona).
#                          SELF-ONLY BY CONSTRUCTION (TRDD-4P1M8I18): it hits
#                          POST /api/sessions/me/restart, whose target is DERIVED
#                          from the caller's AID — there is NO agent argument, so no
#                          invocation can name another agent (stronger than
#                          self-only-by-authorization). The janitor `#J` continuity
#                          path uses this to recover a stuck self. --force overrides
#                          the running-subagents refusal (?force=true).
#
# R42 self-only: `status`/`ensure-resume` take a <self> that must resolve to the
# CALLER's own agent (its own AID); `restart-self` takes NO target at all. An agent
# may act ONLY on itself; the human owner may target any. Cross-agent
# liveness/actuation is the SERVER's job (TRDD-CHN16JXZ), never a call from here.
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# Everything else (waking, injecting) reuses aimaestro-session.sh.
#
# Usage:
#   aimaestro-continuity.sh status <self>
#   aimaestro-continuity.sh ensure-resume <self>
#   aimaestro-continuity.sh restart-self [--force]
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

# _resolve_agent_id() is now shared — see scripts/shell-helpers/common.sh

# TRDD-39OPYXQ9: `_api` is defined HERE, not in common.sh. All three verbs of this CLI
# called it while nothing defined it, so every invocation died `_api: command not found`
# (exit 127) — shellcheck cannot see a call to a function it assumes exists at runtime,
# which is why "shellcheck clean" was true and useless. Copied verbatim from
# aimaestro-trdd.sh rather than promoting it into common.sh: three scripts already carry
# private copies that may have diverged, so consolidating them is its own task with its
# own regression surface (that card's explicit ruling).
_api() {
    local method="$1" path="$2" body="${3:-}"
    local base
    base="$(get_api_base)"
    local -a auth_args=()
    get_auth_args auth_args
    local -a sudo_args=()
    if [ -n "${AIMAESTRO_SUDO_TOKEN:-}" ]; then
        sudo_args=(-H "X-Sudo-Token: ${AIMAESTRO_SUDO_TOKEN}")
    fi

    local resp code out
    if [ -n "$body" ]; then
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${sudo_args[@]}" \
            -H "Content-Type: application/json" -d "$body" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    else
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${sudo_args[@]}" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    fi

    code="$(printf '%s' "$resp" | tail -n1)"
    out="$(printf '%s' "$resp" | sed '$d')"

    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from ${path} (no HTTP status code)" >&2
        return 1
    fi

    if [ "$code" -ge 400 ]; then
        local err
        err="$(printf '%s' "$out" | jq -r '.error // .message // empty' 2>/dev/null)"
        echo "Error: HTTP ${code}${err:+ — ${err}}" >&2
        if [ "$code" = "401" ] || [ "$code" = "403" ]; then
            echo "Hint: agents authenticate with AID_AUTH (export AID_AUTH=\"\$(aid-auth.sh)\")." >&2
            echo "      Humans: run 'aimaestro-governance.sh login' once. Strict routes also need AIMAESTRO_SUDO_TOKEN." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}
# (TRDD-17K0SHDQ; was duplicated byte-identical across 3 scripts).

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

# restart-self — SELF-ONLY BY CONSTRUCTION. Takes NO target: it hits
# POST /api/sessions/me/restart, which derives the session from auth.agentId, so
# there is no path/body argument through which another agent could ever be named.
# Deliberately NOT _resolve_agent_id'd — resolving a ref would re-introduce a
# targetable parameter, defeating the whole point. --force maps to ?force=true
# (override the running-subagents refusal). Any other argument is rejected.
cmd_restart_self() {
    local qs=""
    case "${1:-}" in
        "")        ;;                       # no arg — the normal path
        --force)   qs="?force=true" ;;
        *) echo "Error: restart-self takes no target (self-derived); only optional --force" >&2; return 1 ;;
    esac
    _api POST "/api/sessions/me/restart${qs}" '{}'
}

show_help() {
    cat <<'EOF'
aimaestro-continuity.sh — AI Maestro agent-continuity CLI

  status <self>          the 5 continuity-status fields for this host's account
                         (account_healthy, window_5h_pct, window_7d_pct,
                         cache_ttl_minutes, next_action) — metadata only, no token
  ensure-resume <self>   idempotently ensure THIS agent is resumed (no-op if live)
  restart-self [--force] restart THIS agent's OWN session (self-only by construction —
                         no target; --force overrides the running-subagents refusal)

R42 self-only: `status`/`ensure-resume` take the CALLER's own <self>; `restart-self`
takes no target (server derives it from the caller's AID). Agent callers export AID_AUTH.
EOF
}

case "${1:-help}" in
    status)        shift; cmd_status "$@" ;;
    ensure-resume) shift; cmd_ensure_resume "$@" ;;
    restart-self)  shift; cmd_restart_self "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-continuity.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
