#!/usr/bin/env bash
# AI Maestro Agent Session Commands
# Session lifecycle: add/remove/exec, hibernate, wake, restart
#
# Version: 1.0.0
# Requires: agent-helper.sh, agent-core.sh
#
# Usage: source "$(dirname "$0")/agent-session.sh"

# Double-source guard
[[ -n "${_AGENT_SESSION_LOADED:-}" ]] && return 0
_AGENT_SESSION_LOADED=1

# ============================================================================
# SESSION
# ============================================================================

cmd_session() {
    # LOW-6: shift is protected - ${1:-help} provides default if $1 is empty/unset
    # This means shift will only fail if $# is 0, which is handled by "|| true"
    # The pattern "${1:-default}" + "shift || true" is safe against underflow
    local subcmd="${1:-help}"
    shift || true

    case "$subcmd" in
        add) cmd_session_add "$@" ;;
        remove) cmd_session_remove "$@" ;;
        exec) cmd_session_exec "$@" ;;
        command) cmd_session_command "$@" ;;
        activity-update) cmd_session_activity_update "$@" ;;
        user-input) cmd_session_user_input "$@" ;;
        help|--help|-h)
            cat << 'HELP'
Usage: aimaestro-agent.sh session <subcommand> [options]

Subcommands:
  add <agent>                  Add a new session to agent
  remove <agent>               Remove a session from agent
  exec <agent> <command>       Execute command in agent's session (agent-keyed)
  command <session> -- <cmd>   Send a command to a tmux session BY NAME
  activity-update <session>    Update a session's activity/notification state
  user-input                   Record the human user's last-input timestamp
HELP
            ;;
        *)
            print_error "Unknown session subcommand: $subcmd"
            echo "Run 'aimaestro-agent.sh session help' for usage" >&2  # LOW-003
            return 1 ;;
    esac
}

cmd_session_add() {
    local agent="" role="assistant"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --role)
                [[ $# -lt 2 ]] && { print_error "--role requires a value"; return 1; }
                role="$2"; shift 2 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base)

    local payload
    payload=$(jq -n --arg role "$role" '{role: $role}')

    # Build AID auth header if available
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then
        auth_args=(-H "Authorization: Bearer $AID_AUTH")
    fi

    print_info "Adding session to agent..."
    local response
    response=$(curl -s --max-time 30 -X POST "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}/session" \
        -H "Content-Type: application/json" \
        -d "$payload")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Session added to: $RESOLVED_ALIAS"
}

cmd_session_remove() {
    local agent="" index="0" all=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --index)
                [[ $# -lt 2 ]] && { print_error "--index requires a value"; return 1; }
                index="$2"; shift 2 ;;
            --all) all=true; shift ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    # Validate index is a non-negative integer (AUDIT-2: numeric validation)
    if [[ ! "$index" =~ ^[0-9]+$ ]]; then
        print_error "Session index must be a non-negative integer, got: $index"
        return 1
    fi

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base)

    local url="${api_base}/api/agents/${RESOLVED_AGENT_ID}/session"
    [[ "$all" == true ]] && url="${url}?all=true" || url="${url}?index=${index}"

    # Build AID auth header if available
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then
        auth_args=(-H "Authorization: Bearer $AID_AUTH")
    fi

    print_info "Removing session..."
    local response
    response=$(curl -s --max-time 30 -X DELETE "${auth_args[@]}" "$url")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Session removed from: $RESOLVED_ALIAS"
}

cmd_session_exec() {
    local agent=""
    # MEDIUM-006: Use array for proper argument handling
    local -a cmd_args=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -*) print_error "Unknown option: $1"; return 1 ;;
            *)
                if [[ -z "$agent" ]]; then agent="$1"
                else cmd_args+=("$1")
                fi
                shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }
    [[ ${#cmd_args[@]} -eq 0 ]] && { print_error "Command required"; return 1; }

    # MEDIUM-006: Build command string from array
    # MEDIUM-3: Note on word splitting risk - this uses ${cmd_args[*]} which joins
    # array elements with IFS (default: space). The command is passed to jq as a string
    # and sent via API, so word splitting in the shell is not a concern here.
    # The receiving end is responsible for proper command parsing.
    local command="${cmd_args[*]}"
    # MEDIUM-007: Trim all leading whitespace
    while [[ "$command" == " "* || "$command" == $'\t'* ]]; do
        command="${command#[[:space:]]}"
    done

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base)

    local payload
    payload=$(jq -n --arg cmd "$command" '{command: $cmd}')

    # Build AID auth header if available
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then
        auth_args=(-H "Authorization: Bearer $AID_AUTH")
    fi

    local response
    response=$(curl -s --max-time 30 -X PATCH "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}/session" \
        -H "Content-Type: application/json" \
        -d "$payload")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Command sent to: $RESOLVED_ALIAS"
}

# ============================================================================
# SESSION-NAME-KEYED OPS (added for fleet readiness — wrap the API endpoints the
# core hook / janitor / AMAMA previously called DIRECTLY, so no plugin touches
# the API. All additive; existing `add/remove/exec` are unchanged.)
# ============================================================================

# Send a command to a tmux session BY SESSION NAME (POST /api/sessions/<name>/command).
# Distinct from `session exec` (agent-keyed PATCH): this is what a hook/daemon uses
# when it already holds the tmux session name. Usage:
#   aimaestro-agent.sh session command <session-name> [--require-idle] [--newline] -- <cmd...>
cmd_session_command() {
    local session="" require_idle=false add_newline=false
    local -a cmd_args=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --require-idle) require_idle=true; shift ;;
            --newline) add_newline=true; shift ;;
            --) shift; cmd_args=("$@"); break ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) if [[ -z "$session" ]]; then session="$1"; else cmd_args+=("$1"); fi; shift ;;
        esac
    done
    [[ -z "$session" ]] && { print_error "Session name (tmux) required"; return 1; }
    [[ ${#cmd_args[@]} -eq 0 ]] && { print_error "Command required (after the session name, or after --)"; return 1; }
    # Defence-in-depth: session name is interpolated into the URL path.
    [[ "$session" =~ ^[a-zA-Z0-9_@.-]+$ ]] || { print_error "Invalid session name: $session"; return 1; }
    local command="${cmd_args[*]}"

    local api_base; api_base=$(get_api_base)
    local payload
    payload=$(jq -n --arg cmd "$command" --argjson ri "$require_idle" --argjson nl "$add_newline" \
        '{command: $cmd, requireIdle: $ri, addNewline: $nl}')
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then auth_args=(-H "Authorization: Bearer $AID_AUTH"); fi
    local response
    response=$(curl -s --max-time 15 -X POST "${auth_args[@]}" "${api_base}/api/sessions/${session}/command" \
        -H "Content-Type: application/json" -d "$payload")
    local error; error=$(echo "$response" | jq -r '.error // empty')
    [[ -n "$error" ]] && { print_error "$error"; return 1; }
    print_success "Command sent to session: $session"
}

# Update a session's live activity/notification state (POST /api/sessions/activity/update).
# Usage: aimaestro-agent.sh session activity-update <session-name> \
#          [--status <s>] [--hook-status <h>] [--notification-type <n>]
cmd_session_activity_update() {
    local session="" status="" hook_status="" notif_type=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --status) [[ $# -lt 2 ]] && { print_error "--status requires a value"; return 1; }; status="$2"; shift 2 ;;
            --hook-status) [[ $# -lt 2 ]] && { print_error "--hook-status requires a value"; return 1; }; hook_status="$2"; shift 2 ;;
            --notification-type) [[ $# -lt 2 ]] && { print_error "--notification-type requires a value"; return 1; }; notif_type="$2"; shift 2 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) if [[ -z "$session" ]]; then session="$1"; else print_error "Unexpected arg: $1"; return 1; fi; shift ;;
        esac
    done
    [[ -z "$session" ]] && { print_error "Session name required"; return 1; }
    local api_base; api_base=$(get_api_base)
    local payload; payload=$(jq -n --arg s "$session" '{sessionName: $s}')
    [[ -n "$status" ]]     && payload=$(echo "$payload" | jq --arg v "$status"     '. + {status: $v}')
    [[ -n "$hook_status" ]] && payload=$(echo "$payload" | jq --arg v "$hook_status" '. + {hookStatus: $v}')
    [[ -n "$notif_type" ]] && payload=$(echo "$payload" | jq --arg v "$notif_type"  '. + {notificationType: $v}')
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then auth_args=(-H "Authorization: Bearer $AID_AUTH"); fi
    local response
    response=$(curl -s --max-time 15 -X POST "${auth_args[@]}" "${api_base}/api/sessions/activity/update" \
        -H "Content-Type: application/json" -d "$payload")
    local error; error=$(echo "$response" | jq -r '.error // empty')
    [[ -n "$error" ]] && { print_error "$error"; return 1; }
    print_success "Activity updated for session: $session"
}

# Record the human user's last-input timestamp (POST /api/sessions/me/user-input).
# No body — auth identifies the caller. Used by UserPromptSubmit hooks (AMAMA idle calc).
cmd_session_user_input() {
    local api_base; api_base=$(get_api_base)
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then auth_args=(-H "Authorization: Bearer $AID_AUTH"); fi
    local response
    response=$(curl -s --max-time 15 -X POST "${auth_args[@]}" "${api_base}/api/sessions/me/user-input" \
        -H "Content-Type: application/json")
    local error; error=$(echo "$response" | jq -r '.error // empty')
    [[ -n "$error" ]] && { print_error "$error"; return 1; }
    local ts; ts=$(echo "$response" | jq -r '.recorded_at_epoch // empty')
    print_success "User-input timestamp recorded${ts:+ (epoch $ts)}"
}

# Resolve an agent BY NAME or BY --cwd <path> to its tmux session name (scriptable).
# Default: prints the tmux session name (non-zero exit if none). --json: full object.
# Replaces the find-agent-by-cwd / name->session lookups that callers did via the API.
cmd_resolve() {
    local name="" cwd="" json=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --cwd) [[ $# -lt 2 ]] && { print_error "--cwd requires a value"; return 1; }; cwd="$2"; shift 2 ;;
            --json) json=true; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh resolve <name> | --cwd <path> [--json]
  Resolve an agent (by name, or by working directory) to its tmux session name.
  Default output: the tmux session name (empty + non-zero exit if no live session).
  --json: full object {agentId, name, tmuxSessionName, workingDirectory, status}.
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) if [[ -z "$name" ]]; then name="$1"; else print_error "Unexpected arg: $1"; return 1; fi; shift ;;
        esac
    done
    local api_base; api_base=$(get_api_base)
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then auth_args=(-H "Authorization: Bearer $AID_AUTH"); fi

    local agent_json=""
    if [[ -n "$cwd" ]]; then
        [[ -n "$name" ]] && { print_error "Provide a name OR --cwd, not both"; return 1; }
        local rcwd; rcwd=$(realpath -m "$cwd" 2>/dev/null) || rcwd="$cwd"
        local all; all=$(curl -s --max-time 15 "${auth_args[@]}" "${api_base}/api/agents")
        agent_json=$(echo "$all" | jq -c --arg d "$rcwd" '((.agents // .) // []) | map(select(.workingDirectory == $d)) | .[0] // empty')
        [[ -z "$agent_json" || "$agent_json" == "null" ]] && { print_error "No agent found with workingDirectory: $rcwd"; return 1; }
    else
        [[ -z "$name" ]] && { print_error "Provide an agent name or --cwd <path>"; return 1; }
        resolve_agent "$name" || return 1
        local full; full=$(curl -s --max-time 15 "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}")
        agent_json=$(echo "$full" | jq -c '.agent // empty')
        [[ -z "$agent_json" || "$agent_json" == "null" ]] && { print_error "Could not fetch agent: $name"; return 1; }
    fi

    if [[ "$json" == true ]]; then
        echo "$agent_json" | jq -c '{agentId: .id, name: .name, tmuxSessionName: (.sessions[0].tmuxSessionName // .session.tmuxSessionName // .name), workingDirectory: .workingDirectory, status: (.sessions[0].status // .status // "unknown")}'
    else
        local tmux_name; tmux_name=$(echo "$agent_json" | jq -r '(.sessions[0].tmuxSessionName // .session.tmuxSessionName // .name) // empty')
        [[ -z "$tmux_name" ]] && { print_error "No tmux session for the resolved agent"; return 1; }
        echo "$tmux_name"
    fi
}

# ============================================================================
# HIBERNATE / WAKE
# ============================================================================

cmd_hibernate() {
    local agent=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: aimaestro-agent.sh hibernate <agent>"
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base)

    # Build AID auth header if available
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then
        auth_args=(-H "Authorization: Bearer $AID_AUTH")
    fi

    print_info "Hibernating agent '$RESOLVED_ALIAS'..."
    local response
    response=$(curl -s --max-time 30 -X POST "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}/hibernate")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Agent hibernated: $RESOLVED_ALIAS"
}

cmd_wake() {
    local agent="" attach=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --attach) attach=true; shift ;;
            -h|--help)
                echo "Usage: aimaestro-agent.sh wake <agent> [--attach]"
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base)

    # Build AID auth header if available
    local -a auth_args=()
    if [ -n "${AID_AUTH:-}" ]; then
        auth_args=(-H "Authorization: Bearer $AID_AUTH")
    fi

    print_info "Waking agent '$RESOLVED_ALIAS'..."
    local response
    response=$(curl -s --max-time 30 -X POST "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}/wake")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Agent is awake: $RESOLVED_ALIAS"

    if [[ "$attach" == true ]]; then
        local session_name
        session_name=$(get_agent_session_name "$RESOLVED_AGENT_ID")
        # CRITICAL-2: Validate tmux session name before use
        if [[ -n "$session_name" ]] && validate_tmux_session_name "$session_name"; then
            print_info "Attaching to session..."
            # Use -- to separate options from arguments
            tmux attach-session -t -- "$session_name"
        elif [[ -n "$session_name" ]]; then
            print_error "Invalid tmux session name format"
            return 1
        fi
    fi
}

# ============================================================================
# RESTART (hibernate + wake with verification)
# ============================================================================

cmd_restart() {
    local agent="" wait_time=3

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --wait)
                [[ $# -lt 2 ]] && { print_error "--wait requires a value"; return 1; }
                wait_time="$2"; shift 2 ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh restart <agent> [options]

Restart an agent by hibernating and waking it. Useful after installing
plugins or marketplaces that require a restart.

Options:
  --wait <seconds>    Wait time between hibernate and wake (default: 3)

Notes:
  - Cannot restart the current session (yourself) - use /exit instead
  - Verifies the agent comes back online after restart
  - If restart fails, check agent status with 'aimaestro-agent.sh show <agent>'

Examples:
  # Restart an agent
  aimaestro-agent.sh restart backend-api

  # Restart with longer wait time (for slow systems)
  aimaestro-agent.sh restart backend-api --wait 5
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    resolve_agent "$agent" || return 1

    # Check if trying to restart self
    if is_current_session "$agent"; then
        print_error "Cannot restart the current session (yourself)"
        print_info "To restart this session:"
        echo "  1. Exit Claude Code with '/exit' or Ctrl+C"
        echo "  2. Run 'claude' again in your terminal"
        return 1
    fi

    restart_agent "$RESOLVED_AGENT_ID" "$wait_time"
}
