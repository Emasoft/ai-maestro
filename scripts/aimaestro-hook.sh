#!/usr/bin/env bash
# =============================================================================
# AI Maestro Hook Intermediary CLI
# =============================================================================
#
# The intermediary (ai-maestro side) of the Claude Code session-tracking hook.
#
# Hooks BELONG in the plugin (`ai-maestro-plugin/scripts/ai-maestro-hook.cjs`),
# but a plugin must NEVER call the server API directly — every API touch goes
# through the immutable CLI layer that lives in THIS repo. So the hook is split
# in two:
#   - PLUGIN side: a thin `ai-maestro-hook.cjs` that parses the hook stdin JSON
#     and shells out to THIS script (no `fetch`, no `:23000`, no `/api/...`).
#   - AI-MAESTRO side (this script): the only piece that talks to the API.
#
# Subcommands map 1:1 to the hook's three API operations (was `broadcastStatusUpdate`,
# `sendMessageNotification`, and the unread-inbox check in the .cjs):
#   activity        — report session activity / notification state
#                     (resolve cwd→agent, POST /api/sessions/activity/update)
#   notify          — inject a message-notification into the agent's tmux session
#                     (resolve cwd→agent, POST /api/sessions/<tmux>/command)
#   check-messages  — count unread inbox messages for the agent
#                     (resolve cwd→agent, GET /api/messages?...&status=unread)
#
# Resolution is BY CWD (the directory the hook runs in), using the SAME
# at-or-below-workdir match the .cjs used: an agent matches when its
# workingDirectory EQUALS the cwd, or the cwd is a STRICT SUBDIR of it — never
# a parent (matching a parent caused cross-session prompt-injection when cwd
# was $HOME). This mirrors common.sh's lookup_agent_by_directory but returns
# the full agent object so each subcommand can read the field it needs.
#
# Auth: AID_AUTH Bearer (agent caller) + optional AIMAESTRO_SUDO_TOKEN. Hooks
# are latency-sensitive and fire-and-forget — every call is --max-time bounded;
# the plugin hook invokes this fire-and-forget so a non-zero exit never blocks
# the agent's turn.
#
# Usage:
#   aimaestro-hook.sh activity --cwd <dir> [--status S] [--hook-status H]
#       [--notification-type NT] [--subagent-count N] [--error-type E] [--end-reason R]
#   aimaestro-hook.sh notify --cwd <dir> --message <text>
#   aimaestro-hook.sh check-messages --cwd <dir> [--json]
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

# Resolve a cwd → the matching agent object (compact JSON), or empty.
# Match: agentWd == cwd OR cwd starts with agentWd + "/" (at-or-below, never parent).
_resolve_agent_by_cwd() {
    local cwd="$1"
    local base; base="$(get_api_base)"
    local -a auth_args=(); get_auth_args auth_args
    local resp
    resp="$(curl -s --max-time 5 "${auth_args[@]}" "${base}/api/agents" 2>/dev/null)" || return 1
    printf '%s' "$resp" | jq -c --arg cwd "$cwd" '
        (.agents // []) | map(
            (((.workingDirectory // .session.workingDirectory) // "")) as $wd
            | select($wd != "" and ($wd == $cwd or ($cwd | startswith($wd + "/"))))
        ) | .[0] // empty' 2>/dev/null
}

# Authenticated POST with sudo passthrough. Bounded; soft (prints body, no throw).
_post() {
    local path="$1" body="$2"
    local base; base="$(get_api_base)"
    local -a auth_args=(); get_auth_args auth_args
    local -a sudo_args=()
    [ -n "${AIMAESTRO_SUDO_TOKEN:-}" ] && sudo_args=(-H "X-Sudo-Token: ${AIMAESTRO_SUDO_TOKEN}")
    curl -s --max-time 10 -X POST "${auth_args[@]}" "${sudo_args[@]}" \
        -H "Content-Type: application/json" -d "$body" "${base}${path}"
}

show_help() {
    cat <<'EOF'
aimaestro-hook.sh — intermediary CLI between the plugin's Claude Code hook and the API

Commands:
  activity --cwd <dir> [flags]   Report session activity/notification state
      --status S              activity status (active|idle|exited|…)
      --hook-status H         hook status (defaults to --status)
      --notification-type NT  idle_prompt | permission_prompt | elicitation_dialog
      --subagent-count N      live subagent count
      --error-type E          error class (for StopFailure)
      --end-reason R          session end reason (for SessionEnd)
  notify --cwd <dir> --message <text>   Inject a notification into the agent's tmux session
  check-messages --cwd <dir> [--json]   Count unread inbox messages for the agent
  help

Environment:
  AID_AUTH               Bearer token for the agent caller (optional on localhost)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough (optional)
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

cmd_activity() {
    local cwd="" status="" hook_status="" notif="" subcount="" errtype="" endreason=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --cwd) cwd="$2"; shift 2 ;;
            --status) status="$2"; shift 2 ;;
            --hook-status) hook_status="$2"; shift 2 ;;
            --notification-type) notif="$2"; shift 2 ;;
            --subagent-count) subcount="$2"; shift 2 ;;
            --error-type) errtype="$2"; shift 2 ;;
            --end-reason) endreason="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'activity': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$cwd" ] && { echo "Error: --cwd required" >&2; return 1; }
    local agent; agent="$(_resolve_agent_by_cwd "$cwd")" || true
    [ -z "$agent" ] && { echo "Error: no agent found for cwd: $cwd" >&2; return 1; }
    local session
    session="$(printf '%s' "$agent" | jq -r '.name // .alias // .session.tmuxSessionName // empty')"
    [ -z "$session" ] && { echo "Error: resolved agent has no session name" >&2; return 1; }
    # The hook mirrors hookStatus onto status when not given separately.
    [ -z "$hook_status" ] && hook_status="$status"
    local body
    body="$(jq -nc \
        --arg s "$session" --arg st "$status" --arg hs "$hook_status" --arg nt "$notif" \
        --arg sc "$subcount" --arg et "$errtype" --arg er "$endreason" '
        {sessionName: $s}
        + (if $st != "" then {status: $st} else {} end)
        + (if $hs != "" then {hookStatus: $hs} else {} end)
        + (if $nt != "" then {notificationType: $nt} else {} end)
        + (if $sc != "" then {subagentCount: ($sc|tonumber? // $sc)} else {} end)
        + (if $et != "" then {errorType: $et} else {} end)
        + (if $er != "" then {endReason: $er} else {} end)')"
    _post "/api/sessions/activity/update" "$body" >/dev/null
    echo "activity updated: $session"
}

cmd_notify() {
    local cwd="" message=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --cwd) cwd="$2"; shift 2 ;;
            --message) message="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'notify': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$cwd" ] && { echo "Error: --cwd required" >&2; return 1; }
    [ -z "$message" ] && { echo "Error: --message required" >&2; return 1; }
    local agent; agent="$(_resolve_agent_by_cwd "$cwd")" || true
    [ -z "$agent" ] && { echo "Error: no agent found for cwd: $cwd" >&2; return 1; }
    local tmux
    tmux="$(printf '%s' "$agent" | jq -r '(.sessions[0].tmuxSessionName // .session.tmuxSessionName // .name) // empty')"
    [ -z "$tmux" ] && { echo "Error: resolved agent has no tmux session" >&2; return 1; }
    # Defence-in-depth: the session name is interpolated into the URL path.
    [[ "$tmux" =~ ^[a-zA-Z0-9_@.-]+$ ]] || { echo "Error: invalid session name: $tmux" >&2; return 1; }
    local body; body="$(jq -nc --arg cmd "$message" '{command: $cmd, requireIdle: false, addNewline: false}')"
    _post "/api/sessions/${tmux}/command" "$body" >/dev/null
    echo "notified: $tmux"
}

cmd_check_messages() {
    local cwd="" json=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --cwd) cwd="$2"; shift 2 ;;
            --json) json=true; shift ;;
            *) echo "Error: unknown flag for 'check-messages': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$cwd" ] && { echo "Error: --cwd required" >&2; return 1; }
    local agent; agent="$(_resolve_agent_by_cwd "$cwd")" || true
    [ -z "$agent" ] && { echo "Error: no agent found for cwd: $cwd" >&2; return 1; }
    local aid; aid="$(printf '%s' "$agent" | jq -r '.id // empty')"
    [ -z "$aid" ] && { echo "Error: resolved agent has no id" >&2; return 1; }
    local base; base="$(get_api_base)"
    local -a auth_args=(); get_auth_args auth_args
    local enc; enc="$(printf '%s' "$aid" | jq -sRr @uri)"
    local resp
    resp="$(curl -s --max-time 10 "${auth_args[@]}" "${base}/api/messages?agent=${enc}&box=inbox&status=unread" 2>/dev/null)" || true
    if [ "$json" = true ]; then
        printf '%s\n' "${resp:-[]}"
    else
        printf '%s' "${resp:-}" | jq -r '(.messages // . // []) | length' 2>/dev/null || echo 0
    fi
}

case "${1:-help}" in
    activity)       shift; cmd_activity "$@" ;;
    notify)         shift; cmd_notify "$@" ;;
    check-messages) shift; cmd_check_messages "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v)   echo "aimaestro-hook.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
