#!/usr/bin/env bash
# =============================================================================
# AMP Project Info - Show Team and Project Info
# =============================================================================
#
# Show team and project info for the current agent.
#
# Usage:
#   amp-project-info.sh [--team <teamId>] [--id <agentUUID>]
#
# Examples:
#   amp-project-info.sh
#   amp-project-info.sh --team my-team-id
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
    echo "Usage: amp-project-info.sh [--team <teamId>] [--id <agentUUID>]"
    echo ""
    echo "Show team and project info for the current agent."
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

# Auto-detect team from agent registry if not provided
if [ -z "$TEAM_ID" ]; then
    AGENT_ID="${CLAUDE_AGENT_ID:-$(amp_resolve_agent_id)}"
    # TRDD-2U56TLBX: FETCH then PARSE, so "the server did not answer" and "the agent has no
    # team" stay distinguishable. Fused as `$(curl -sf … | jq …)` under `set -eo pipefail`, a
    # curl failure kills the script AT THE ASSIGNMENT and the check below never runs; a bare
    # `|| true` would reach it with the WRONG message, blaming the agent's team membership
    # for a server that was never asked. jq is guarded because it exits 5 on non-JSON
    # (measured), which would abort here just the same.
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

# Fetch team info
TEAM_JSON=$(curl -sf "$API/api/teams/$TEAM_ID") || TEAM_JSON=""
if [ -z "$TEAM_JSON" ]; then
    echo "Error: no answer for team $TEAM_ID from $API." >&2
    exit 1
fi
echo "$TEAM_JSON" | jq '{
  name: .name,
  description: .description,
  type: .type,
  members: (.agentIds | length),
  chiefOfStaff: .chiefOfStaffId,
  orchestrator: .orchestratorId,
  githubProject: .githubProject,
  created: .createdAt
}'
