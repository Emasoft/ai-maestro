#!/usr/bin/env bash
# =============================================================================
# AMP Project Repos - List Project Repositories
# =============================================================================
#
# List repositories for a team's project.
#
# Usage:
#   amp-project-repos.sh [--team <teamId>] [--id <agentUUID>]
#
# Examples:
#   amp-project-repos.sh
#   amp-project-repos.sh --team my-team-id
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

TEAM_ID=""

show_help() {
    echo "Usage: amp-project-repos.sh [--team <teamId>] [--id <agentUUID>]"
    echo ""
    echo "List repositories for a team's project."
    echo ""
    echo "Options:"
    echo "  --team TEAMID   Team ID to query (auto-detected from agent if omitted)"
    echo "  --id UUID       Operate as this agent (UUID from config.json)"
    echo "  --help, -h      Show this help"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --team) TEAM_ID="$2"; shift 2 ;;
        --id) shift 2 ;;  # Already handled in pre-source parsing
        --help|-h) show_help; exit 0 ;;
        *) shift ;;
    esac
done

API="${AIMAESTRO_API:-http://localhost:23000}"

if [ -z "$TEAM_ID" ]; then
    AGENT_ID="${CLAUDE_AGENT_ID:-$(amp_resolve_agent_id)}"
    # TRDD-2U56TLBX: FETCH then PARSE — see the matching block in `amp-project-info.sh`.
    # Fused, a curl failure kills the script at the assignment before the check below runs;
    # a bare `|| true` reaches it with the wrong message.
    AGENT_JSON=$(curl -sf "$API/api/agents/$AGENT_ID") || AGENT_JSON=""
    if [ -z "$AGENT_JSON" ]; then
        echo "Error: no answer from AI Maestro at $API — cannot resolve the team." >&2
        exit 1
    fi
    TEAM_ID=$(echo "$AGENT_JSON" | jq -r '.agent.teamId // empty') || TEAM_ID=""
    if [ -z "$TEAM_ID" ]; then
        echo "Error: Agent is not in a team. Use --team <id>" >&2
        exit 1
    fi
fi

# The `||` block matters even though this is the last statement: under `pipefail` a failed
# curl fails the whole pipeline, and without it the script exits with curl's raw status and
# prints NOTHING — a caller asking "which repos does my team own" gets silence, not an error.
REPOS_JSON=$(curl -sf "$API/api/teams/$TEAM_ID/repos") || REPOS_JSON=""
if [ -z "$REPOS_JSON" ]; then
    echo "Error: no answer for team $TEAM_ID's repos from $API." >&2
    exit 1
fi
echo "$REPOS_JSON" | jq '.'
