#!/usr/bin/env bash
# Stop hook — scenarios auto-continue guard (project-scoped).
#
# When a `run-scenarios-batch` conductor session is mid-batch and Claude tries
# to stop, this hook checks the batch state file and, if the batch is still
# in progress, tells Claude to keep working by returning a "block" decision
# with a pointer to the next action.
#
# State file location: ${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-state.json
#
# State file schema:
#   {
#     "status": "in_progress" | "done" | "failed",
#     "range": "16-20",
#     "current_scenario": 18,
#     "completed_scenarios": [16, 17],
#     "failed_scenarios": [],
#     "iteration_count": 3,
#     "max_iterations": 200,
#     "next_action": "spawn scenario-runner subagent for SCEN-018",
#     "updated_at": "2026-04-13T14:30:00Z"
#   }
#
# Exit codes:
#   0 — let Claude stop (batch done, failed, or no state file)
#   2 — block Claude stopping (emit JSON on stdout, Claude keeps working)

set -euo pipefail

# Locate state file — project-scoped, no HOME fallback
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-state.json" ]; then
  STATE_FILE="${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-state.json"
else
  # No state file → no batch in progress → let Claude stop normally
  exit 0
fi

# Parse state (require jq; if missing, fail open)
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

STATUS=$(jq -r '.status // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
ITER=$(jq -r '.iteration_count // 0' "$STATE_FILE" 2>/dev/null || echo 0)
MAX_ITER=$(jq -r '.max_iterations // 200' "$STATE_FILE" 2>/dev/null || echo 200)

# Safety: never loop forever
if [ "$ITER" -ge "$MAX_ITER" ]; then
  cat >&2 <<EOF
[scenarios] Stop hook: iteration count ($ITER) reached cap ($MAX_ITER).
Letting Claude stop to prevent an infinite loop. Batch state file:
  $STATE_FILE
Inspect the state file and reset iteration_count if you want to continue.
EOF
  exit 0
fi

if [ "$STATUS" != "in_progress" ]; then
  # done / failed / unknown → let Claude stop
  exit 0
fi

# Batch is in progress. Increment iteration_count and emit a block decision.
NEXT_ACTION=$(jq -r '.next_action // "continue the batch"' "$STATE_FILE" 2>/dev/null)
CURRENT=$(jq -r '.current_scenario // "?"' "$STATE_FILE" 2>/dev/null)
RANGE=$(jq -r '.range // "?"' "$STATE_FILE" 2>/dev/null)

# Increment iteration_count in-place (best effort)
TMP=$(mktemp)
if jq --argjson inc 1 '.iteration_count = ((.iteration_count // 0) + $inc) | .updated_at = (now | todate)' \
    "$STATE_FILE" > "$TMP" 2>/dev/null; then
  mv "$TMP" "$STATE_FILE"
else
  rm -f "$TMP"
fi

# Emit the block decision. Claude reads this JSON from stdout.
cat <<EOF
{"decision": "block", "reason": "Scenario batch $RANGE is still in progress (scenario $CURRENT, iteration $ITER/$MAX_ITER). Next action: $NEXT_ACTION. Resume the run-scenarios-batch conductor — read ${STATE_FILE} to pick up the exact batch state, then continue the main loop."}
EOF
exit 2
