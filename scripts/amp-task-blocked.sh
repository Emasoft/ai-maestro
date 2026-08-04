#!/usr/bin/env bash
# =============================================================================
# AMP Task Blocked - Report a blocking issue to the Orchestrator
# =============================================================================
#
# Send a high-priority blocking issue message to the team's orchestrator via AMP.
#
# Usage:
#   amp-task-blocked.sh <reason> [--id <agent-uuid>]
#
# Examples:
#   amp-task-blocked.sh "Cannot access staging DB, credentials expired"
#   amp-task-blocked.sh "Dependency conflict blocks build" --id abc-123-def
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

REASON=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) shift 2 ;;  # Already handled in pre-source parsing
    --help|-h)
      echo "Usage: amp-task-blocked.sh <reason> [--id <agent-uuid>]"
      echo ""
      echo "Send a high-priority blocking issue to the team's orchestrator."
      echo "Signals work cannot proceed; on the kanban this corresponds to the"
      echo "'blocked' exception state of the 14-stage TRDD-v2 pipeline (move the"
      echo "card with: amp-kanban-move.sh <task-id> blocked)."
      echo ""
      echo "Arguments:"
      echo "  reason    Description of what is blocking progress"
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
  echo "Usage: amp-task-blocked.sh <reason>" >&2
  exit 1
fi

REASON="${POSITIONAL[0]}"

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
# TRDD-2U56TLBX. Each lookup is split into FETCH-then-PARSE, and that is not style — it is
# the only way to tell "the server did not answer" from "the answer is legitimately empty".
# Fused as `VAR=$(curl -sf … | jq …)`, three things go wrong at once under `set -eo pipefail`:
#
#   1. a curl failure fails the pipeline and takes the script down AT THE ASSIGNMENT, so the
#      `if [ -z … ]` check below never runs — a bare exit 7 with no diagnostic;
#   2. the naive repair (`|| true`) is WORSE HERE than the bug. A failed team lookup would
#      leave ORCH_ID empty, and that branch prints a warning and `exit 0` — so a BLOCKER an
#      agent reported would be silently dropped and the script would claim success. This is
#      the one place in the AMP scripts where a bare guard flips a loud failure into a quiet
#      one, which is why this family was deliberately held back from phases 1-2;
#   3. even with the network handled, the existing message would be a lie: "Agent is not in a
#      team" when the truth is that nobody could be asked.
#
# jq is guarded too, measured: it exits 0 on EMPTY input but 5 on NON-JSON (a proxy's HTML
# error page under HTTP 200), which would abort the script all over again.
AGENT_JSON=$(curl -sf "$API/api/agents/$AGENT_ID") || AGENT_JSON=""
if [ -z "$AGENT_JSON" ]; then
  echo "Error: no answer from AI Maestro at $API — the blocker was NOT reported." >&2
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
  # covers both a dead server and a team that has gone away. Either way the actionable half
  # is the same and it is stated — nothing was reported.
  echo "Error: no answer for team $TEAM_ID from $API — the blocker was NOT reported." >&2
  exit 1
fi
ORCH_ID=$(echo "$TEAM_JSON" | jq -r '.orchestratorId // empty' 2>/dev/null) || ORCH_ID=""
if [ -z "$ORCH_ID" ]; then
  # Reached ONLY when the team genuinely has no orchestrator — a server that did not answer
  # exits 1 above rather than falling into this exit 0.
  echo "Warning: No orchestrator assigned — nothing was sent." >&2
  exit 0
fi

# Get orchestrator name for AMP
ORCH_JSON=$(curl -sf "$API/api/agents/$ORCH_ID") || ORCH_JSON=""
ORCH_NAME=$(echo "$ORCH_JSON" | jq -r '.agent.name // empty' 2>/dev/null) || ORCH_NAME=""
if [ -n "$ORCH_NAME" ]; then
  "$SCRIPT_DIR/amp-send.sh" "$ORCH_NAME" "Task Blocked" "$REASON" --priority high
  echo "Blocker reported to orchestrator: $ORCH_NAME"
else
  echo "Error: Could not resolve orchestrator name" >&2
  exit 1
fi
