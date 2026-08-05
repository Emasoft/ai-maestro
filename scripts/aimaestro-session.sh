#!/usr/bin/env bash
# =============================================================================
# AI Maestro Session Control CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro agent terminal-control API.
# Plugins (the janitor, MANAGER, every governance agent) call THIS script, never
# the HTTP API directly: the skill-facing CLI here is immutable, while the server
# API behind it may change freely. New capability = new subcommand or new
# optional flag only.
#
# Covers the whole "drive a live Claude Code terminal" surface:
#   inject / slash   — type a command into the agent's tmux pane
#   state            — the agent's live session + pane status
#   read-prompt      — the permission / question menu the agent is blocked on
#   answer           — answer that menu, by option key or free text
#   queue / queue-*  — enqueue a command to fire when the agent is next idle
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).
# `answer` and `queue` hit strict-classified routes (they inject keystrokes into
# a live terminal), so a USER caller must supply AIMAESTRO_SUDO_TOKEN; an AGENT
# caller authorizes by AID + governance title (the R32 dual-path) and never
# needs one.
#
# WHAT AN AGENT MAY AIM AT ANOTHER AGENT — read this before assuming a title is
# enough. The verbs split in two, and the split is not by danger, it is by whose
# decision the keystroke expresses:
#
#   inject / slash / queue / state --pane  →  SELF-ONLY for every title.
#       R42 revoked cross-agent drive outright: an injected command IS the
#       victim's own action, taken without its judgment. No title is exempt, and
#       that includes MANAGER and CHIEF-OF-STAFF. Aim these at another agent and
#       the server answers 403 — correctly. Use AMP messaging: ask, never inject.
#
#   read-prompt / answer  →  the R42.8 exception (USER ruling, 2026-08-05).
#       A MANAGER may answer any agent's PENDING prompt; a CHIEF-OF-STAFF may
#       answer one for agents OF ITS OWN TEAM. Never an ASSISTANT, under any
#       title. Answering your OWN prompt has always been allowed. `answer` also
#       requires a prompt to actually be pending — with none, it 409s, because
#       an unblock answers a question the agent raised and nothing else.
#
# This block replaced a line that said agent callers "authorize by AID +
# governance title" full stop. That described the PRE-R42 world and had been
# false since 2026-07-14: a MANAGER following it refused twice to unblock a
# stalled agent, then escalated to the human, because the CLI advertised an
# authority the API had already revoked.
#
# Usage:
#   aimaestro-session.sh inject <agent> --command "<text>" [--no-newline] [--require-idle]
#   aimaestro-session.sh slash <agent> <command-key>
#   aimaestro-session.sh slash-keys
#   aimaestro-session.sh state <agent> [--pane]
#   aimaestro-session.sh read-prompt <agent>
#   aimaestro-session.sh answer <agent> --option <key> | --text "<answer>"
#   aimaestro-session.sh queue <agent> --command "<text>" | --command-key <key>
#       [--when idle|online|now-if-idle-else-queue] [--wake-first]
#   aimaestro-session.sh queue-list <agent>
#   aimaestro-session.sh queue-cancel <agent> <entryId>
#
# <agent> is an agent UUID, or a name/alias resolved via /api/agents?q=.
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

# ---------------------------------------------------------------------------
# _api METHOD PATH [json_body]
# Prints body on 2xx; "Error: HTTP <code> — <.error>" + return 1 on >=400.
# Fail-closed on a missing/unparseable status line (same contract as
# aimaestro-teams.sh::_api — an empty body must never flow downstream as 2xx).
# ---------------------------------------------------------------------------
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
        # A strict route rejecting an unauthenticated USER is the single most
        # common failure here; name the remedy instead of leaving a bare 401/403.
        if [ "$code" = "401" ] || [ "$code" = "403" ]; then
            echo "Hint: strict routes need AIMAESTRO_SUDO_TOKEN (user) or AID_AUTH (agent)." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}

# Resolve an agent UUID from a UUID, name, or alias. Prints the UUID.
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

# Resolve an agent's tmux session name (the /api/sessions/<name>/... key).
_resolve_session_name() {
    local id="$1"
    local resp
    resp="$(_api GET "/api/agents/${id}")" || return 1
    printf '%s' "$resp" | jq -r '.agent.sessions[0].tmuxSessionName // .agent.name // empty'
}

show_help() {
    cat <<'EOF'
aimaestro-session.sh — AI Maestro agent terminal-control CLI

Commands:
  inject <agent> --command "<text>"     Type arbitrary text into the agent's pane
      --no-newline                      Do not press Enter after the text
      --require-idle                    Refuse unless the agent is at an idle prompt
  slash <agent> <command-key>           Send a curated slash command (allowlisted)
  slash-keys                            List the allowed command keys
  state <agent>                         Session status (online/offline, activity)
      --pane                            Also fetch the live tmux pane status
  read-prompt <agent>                   The pending permission/question prompt, or null
  answer <agent> --option <key>         Answer the pending prompt by option key
  answer <agent> --text "<answer>"      Answer the pending prompt with free text
  queue <agent> --command "<text>"      Enqueue a command for the next idle window
  queue <agent> --command-key <key>     Enqueue a curated slash command
      --when idle|online|now-if-idle-else-queue    (default: idle)
      --wake-first                      Wake a hibernated agent, then run it
  queue-list <agent>                    List the agent's pending queue entries
  queue-cancel <agent> <entryId>        Cancel one queued entry
  help

Strict routes (answer, queue) require AIMAESTRO_SUDO_TOKEN for USER callers.
Agent callers authorize by AID_AUTH + governance title and need no sudo token.

Cross-agent limits (R42 / R42.8) — a title alone is NOT enough:
  inject, slash, queue, state --pane    SELF-ONLY for every title, MANAGER and
                                        CHIEF-OF-STAFF included. Ask by AMP.
  read-prompt, answer                   MANAGER: any agent. CHIEF-OF-STAFF: its
                                        own team. Never an ASSISTANT. Requires a
                                        prompt to actually be pending (else 409).

Environment:
  AID_AUTH               Bearer token for agent callers (REQUIRED — no localhost exemption)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough for strict routes
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

cmd_inject() {
    local ref="${1:-}"; shift || true
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local text="" newline="true" require_idle="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --command)      text="$2"; shift 2 ;;
            --no-newline)   newline="false"; shift ;;
            --require-idle) require_idle="true"; shift ;;
            *) echo "Error: unknown flag for 'inject': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$text" ] && { echo "Error: inject requires --command \"<text>\"" >&2; return 1; }
    local id body
    id="$(_resolve_agent_id "$ref")" || return 1
    body="$(jq -nc --arg c "$text" --argjson nl "$newline" --argjson ri "$require_idle" \
        '{command: $c, addNewline: $nl, requireIdle: $ri}')"
    _api PATCH "/api/agents/${id}/session" "$body"
}

cmd_slash() {
    local ref="${1:-}" key="${2:-}"
    [ -z "$ref" ] || [ -z "$key" ] && { echo "Error: agent and command-key required" >&2; return 1; }
    local id body
    id="$(_resolve_agent_id "$ref")" || return 1
    # The server resolves the key against its allowlist and sends only the fixed
    # literal command; an unknown key is a 400 there. We do NOT mirror the list
    # here — one source of truth (lib/agent-commands.ts).
    body="$(jq -nc --arg k "$key" '{commandKey: $k}')"
    _api PATCH "/api/agents/${id}/session" "$body"
}

# Ask the server for the allowlist rather than hardcoding it — one source of
# truth (lib/agent-commands.ts, surfaced by GET /api/agents/commands).
cmd_slash_keys() {
    _api GET "/api/agents/commands"
}

cmd_state() {
    local ref="${1:-}"; shift || true
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local want_pane="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --pane) want_pane="true"; shift ;;
            *) echo "Error: unknown flag for 'state': $1" >&2; return 1 ;;
        esac
    done
    local id session
    id="$(_resolve_agent_id "$ref")" || return 1
    if [ "$want_pane" = "false" ]; then
        _api GET "/api/agents/${id}/session"
        return
    fi
    # --pane merges the agent-scoped session status with the tmux-pane status,
    # which is keyed by SESSION NAME (not agent id) on /api/sessions/<name>/…
    session="$(_resolve_session_name "$id")" || return 1
    [ -z "$session" ] && { echo "Error: agent has no session to inspect" >&2; return 1; }
    local a b
    a="$(_api GET "/api/agents/${id}/session")" || return 1
    b="$(_api GET "/api/sessions/${session}/pane-status")" || return 1
    jq -nc --argjson session "$a" --argjson pane "$b" '{session: $session, pane: $pane}'
}

cmd_read_prompt() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api GET "/api/agents/${id}/prompt"
}

cmd_answer() {
    local ref="${1:-}"; shift || true
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local option="" text="" option_set="false" text_set="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --option) option="$2"; option_set="true"; shift 2 ;;
            --text)   text="$2";   text_set="true";   shift 2 ;;
            *) echo "Error: unknown flag for 'answer': $1" >&2; return 1 ;;
        esac
    done
    # XOR, checked client-side too so the caller gets a clear message instead of
    # a 400 round-trip. The server enforces the same rule authoritatively.
    if [ "$option_set" = "$text_set" ]; then
        echo "Error: answer needs exactly one of --option <key> or --text \"<answer>\"" >&2
        return 1
    fi
    local id body
    id="$(_resolve_agent_id "$ref")" || return 1
    if [ "$option_set" = "true" ]; then
        body="$(jq -nc --arg o "$option" '{optionKey: $o}')"
    else
        body="$(jq -nc --arg t "$text" '{text: $t}')"
    fi
    _api POST "/api/agents/${id}/prompt/answer" "$body"
}

cmd_queue() {
    local ref="${1:-}"; shift || true
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local text="" key="" when="" wake_first="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --command)     text="$2"; shift 2 ;;
            --command-key) key="$2";  shift 2 ;;
            --when)        when="$2"; shift 2 ;;
            --wake-first)  wake_first="true"; shift ;;
            *) echo "Error: unknown flag for 'queue': $1" >&2; return 1 ;;
        esac
    done
    if { [ -n "$text" ] && [ -n "$key" ]; } || { [ -z "$text" ] && [ -z "$key" ]; }; then
        echo "Error: queue needs exactly one of --command \"<text>\" or --command-key <key>" >&2
        return 1
    fi
    local id body
    id="$(_resolve_agent_id "$ref")" || return 1
    body="$(jq -nc --arg c "$text" --arg k "$key" --arg w "$when" --argjson wf "$wake_first" '
        {}
        + (if $c != "" then {command: $c} else {} end)
        + (if $k != "" then {commandKey: $k} else {} end)
        + (if $w != "" then {when: $w} else {} end)
        + (if $wf then {wakeFirst: true} else {} end)')"
    _api POST "/api/agents/${id}/queue" "$body"
}

cmd_queue_list() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api GET "/api/agents/${id}/queue"
}

cmd_queue_cancel() {
    local ref="${1:-}" entry="${2:-}"
    [ -z "$ref" ] || [ -z "$entry" ] && { echo "Error: agent and entryId required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api DELETE "/api/agents/${id}/queue/${entry}"
}

case "${1:-help}" in
    inject)       shift; cmd_inject "$@" ;;
    slash)        shift; cmd_slash "$@" ;;
    slash-keys)   shift; cmd_slash_keys "$@" ;;
    state)        shift; cmd_state "$@" ;;
    read-prompt)  shift; cmd_read_prompt "$@" ;;
    answer)       shift; cmd_answer "$@" ;;
    queue)        shift; cmd_queue "$@" ;;
    queue-list)   shift; cmd_queue_list "$@" ;;
    queue-cancel) shift; cmd_queue_cancel "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-session.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
