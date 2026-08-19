#!/usr/bin/env bash
# =============================================================================
# AMP Kanban Get - Fetch one kanban task by id
# =============================================================================
#
# Read a single task from the team kanban board via AI Maestro API.
# Resolves team ID from the agent's registration unless --team is provided.
#
# Usage:
#   amp-kanban-get.sh <task-id> [options]
#
# Examples:
#   amp-kanban-get.sh abc-123
#   amp-kanban-get.sh abc-123 --team <team-id>
#
# =============================================================================

set -eo pipefail

# Pre-source: extract --id to set agent identity before helper resolves it
_amp_prev=""
for _amp_arg in "$@"; do
    if [ "$_amp_prev" = "--id" ]; then
        export CLAUDE_AGENT_ID="$_amp_arg"
        break
    fi
    _amp_prev="$_amp_arg"
done
unset _amp_prev _amp_arg

# Source helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/amp-helper.sh"

# Auth for the ai-maestro API (TRDD-17K0SHDQ probe finding, 2026-08-19): these CLIs sent NO
# Authorization header at all, so once the server dropped its localhost exemption every kanban
# verb 401'd for every agent. `get_auth_args` is the ONE resolution order every aimaestro-*
# CLI uses (AID_AUTH bearer for an agent, aim_session cookie for the human) — never inline a
# second copy. Expanded with the bash-3.2-safe empty-array idiom (TRDD-ARY3NRFC).
if [ -f "${SCRIPT_DIR}/shell-helpers/common.sh" ]; then
    source "${SCRIPT_DIR}/shell-helpers/common.sh"
elif [ -f "${HOME}/.local/share/aimaestro/shell-helpers/common.sh" ]; then
    source "${HOME}/.local/share/aimaestro/shell-helpers/common.sh"
else
    echo "Error: cannot locate shell-helpers/common.sh (needed for API auth)" >&2
    exit 2
fi
_KANBAN_AUTH=()
get_auth_args _KANBAN_AUTH

# =============================================================================
# Arguments
# =============================================================================
TASK_ID=""
TEAM_ID=""

show_help() {
    echo "Usage: amp-kanban-get.sh <task-id> [options]"
    echo ""
    echo "Fetch one kanban task by id, with all of its fields."
    echo ""
    echo "Arguments:"
    echo "  task-id    Task UUID or external reference"
    echo ""
    echo "Options:"
    echo "  --team TEAM_ID    Team UUID (auto-detected from agent if omitted)"
    echo "  --id UUID         Operate as this agent (UUID from config.json)"
    echo "  --help, -h        Show this help"
    echo ""
    echo "Examples:"
    echo "  amp-kanban-get.sh abc-123"
    echo "  amp-kanban-get.sh abc-123 --team team-uuid"
}

# Parse arguments
POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case $1 in
        --team)
            TEAM_ID="$2"
            shift 2
            ;;
        --id)
            shift 2  # Already handled in pre-source parsing
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Run 'amp-kanban-get.sh --help' for usage." >&2
            exit 1
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

if [ ${#POSITIONAL[@]} -lt 1 ]; then
    echo "Error: Missing required argument <task-id>." >&2
    echo "" >&2
    show_help
    exit 1
fi

TASK_ID="${POSITIONAL[0]}"

API="${AIMAESTRO_API:-http://localhost:23000}"

# =============================================================================
# Resolve team ID from agent's registration if not provided
# =============================================================================
if [ -z "$TEAM_ID" ]; then
    AGENT_UUID="${CLAUDE_AGENT_ID:-}"
    if [ -z "$AGENT_UUID" ] && [ -f "${AMP_CONFIG:-}" ]; then
        AGENT_UUID=$(jq -r '.agent.id // .id // empty' "$AMP_CONFIG" 2>/dev/null)
    fi

    if [ -n "$AGENT_UUID" ]; then
        TEAM_ID=$(curl -sf ${_KANBAN_AUTH[@]+"${_KANBAN_AUTH[@]}"} "$API/api/agents/$AGENT_UUID" 2>/dev/null | jq -r '.agent.teamId // empty' 2>/dev/null) || true
    fi

    if [ -z "$TEAM_ID" ]; then
        echo "Error: Could not determine team ID. Use --team <team-id> to specify." >&2
        exit 1
    fi
fi

# =============================================================================
# Fetch the task
# =============================================================================
# `|| true` is LOAD-BEARING (TRDD-2U56TLBX). Under `set -e` an assignment whose command
# substitution fails takes the script down with that command's exit status, so an unreachable
# server (curl exit 7) killed it HERE and the "❌ Failed to get task" branch below never
# ran — a bare exit 7 with no diagnostic. curl still writes `000` through `-w`, so that
# branch now reports honestly. Guard only: the branch already ends in `exit 1`.
RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout 5 --max-time 15 ${_KANBAN_AUTH[@]+"${_KANBAN_AUTH[@]}"} \
    "$API/api/teams/$TEAM_ID/tasks/$TASK_ID") || true

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "$RESP_BODY" | jq '.'
else
    echo "❌ Failed to get task (HTTP ${HTTP_CODE})" >&2
    ERROR_MSG=$(echo "$RESP_BODY" | jq -r '.error // "Unknown error"' 2>/dev/null)
    if [ -n "$ERROR_MSG" ] && [ "$ERROR_MSG" != "null" ]; then
        echo "   Error: ${ERROR_MSG}" >&2
    fi
    exit 1
fi
