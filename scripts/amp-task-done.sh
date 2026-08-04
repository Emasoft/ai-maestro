#!/usr/bin/env bash
# =============================================================================
# AMP Task Done - Report task completion to the Orchestrator
# =============================================================================
#
# Send a task completion message to the team's orchestrator via AMP.
#
# Usage:
#   amp-task-done.sh <message> [--id <agent-uuid>]
#
# Examples:
#   amp-task-done.sh "API refactor complete, all tests pass"
#   amp-task-done.sh "Deployed v2.1.0 to staging" --id abc-123-def
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

MESSAGE=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) shift 2 ;;  # Already handled in pre-source parsing
    --help|-h)
      echo "Usage: amp-task-done.sh <message> [--id <agent-uuid>]"
      echo ""
      echo "Send a task completion message to the team's orchestrator."
      echo "Signals the work is done; on the kanban this corresponds to the"
      echo "'complete' column of the 14-stage TRDD-v2 pipeline (move the card"
      echo "with: amp-kanban-move.sh <task-id> complete)."
      echo ""
      echo "Arguments:"
      echo "  message   Completion message describing what was done"
      echo ""
      echo "Options:"
      echo "  --id UUID   Operate as this agent (UUID from config.json)"
      echo "  --help, -h  Show this help"
      exit 0
      ;;
    -*) shift ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [ ${#POSITIONAL[@]} -lt 1 ]; then
  echo "Usage: amp-task-done.sh <message>" >&2
  exit 1
fi

MESSAGE="${POSITIONAL[0]}"

API="${AIMAESTRO_API:-http://localhost:23000}"

# Resolve agent ID from AMP config
require_init
AGENT_ID=$(jq -r '.agent.id // empty' "$AMP_CONFIG" 2>/dev/null)
if [ -z "$AGENT_ID" ]; then
  AGENT_ID="${CLAUDE_AGENT_ID:-}"
fi

if [ -z "$AGENT_ID" ]; then
  echo "Error: Cannot determine agent ID" >&2
  exit 1
fi

# Find orchestrator from agent's team.
#
# TRDD-2U56TLBX. FETCH-then-PARSE per lookup, for the reasons written out in full at the
# matching block in `amp-task-blocked.sh`: fused as `VAR=$(curl -sf … | jq …)` under
# `set -eo pipefail`, a curl failure kills the script at the assignment before its own check
# can run, and the naive `|| true` repair is WORSE than the bug here — an unreachable server
# would leave ORCH_ID empty, and that branch `exit 0`s, so a completion report would be
# dropped while the script claimed success.
#
# jq is guarded too, measured: exit 0 on EMPTY input, 5 on NON-JSON — which would abort again.
AGENT_JSON=$(curl -sf "$API/api/agents/$AGENT_ID") || AGENT_JSON=""
if [ -z "$AGENT_JSON" ]; then
  echo "Error: no answer from AI Maestro at $API — the completion was NOT reported." >&2
  exit 1
fi
TEAM_ID=$(echo "$AGENT_JSON" | jq -r '.agent.teamId // empty' 2>/dev/null) || TEAM_ID=""
if [ -z "$TEAM_ID" ]; then
  echo "Error: Agent is not in a team" >&2
  exit 1
fi

TEAM_JSON=$(curl -sf "$API/api/teams/$TEAM_ID") || TEAM_JSON=""
if [ -z "$TEAM_JSON" ]; then
  # "no answer" rather than "unreachable": curl -sf also fails on an HTTP error, so this
  # covers both a dead server and a team that has gone away.
  echo "Error: no answer for team $TEAM_ID from $API — the completion was NOT reported." >&2
  exit 1
fi
ORCH_ID=$(echo "$TEAM_JSON" | jq -r '.orchestratorId // empty' 2>/dev/null) || ORCH_ID=""
if [ -z "$ORCH_ID" ]; then
  # Reached ONLY when the team genuinely has no orchestrator. The message used to say
  # "sending to team" and then `exit 0` WITHOUT sending anything to anyone — a claim the code
  # never made good on, independent of any network fault. Corrected to say what happens.
  echo "Warning: No orchestrator assigned — nothing was sent." >&2
  exit 0
fi

# Get orchestrator name for AMP
ORCH_JSON=$(curl -sf "$API/api/agents/$ORCH_ID") || ORCH_JSON=""
ORCH_NAME=$(echo "$ORCH_JSON" | jq -r '.agent.name // empty' 2>/dev/null) || ORCH_NAME=""
if [ -n "$ORCH_NAME" ]; then
  "$SCRIPT_DIR/amp-send.sh" "$ORCH_NAME" "Task Complete" "$MESSAGE"
  echo "Reported to orchestrator: $ORCH_NAME"
else
  echo "Error: Could not resolve orchestrator name" >&2
  exit 1
fi
