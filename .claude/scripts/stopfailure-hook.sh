#!/usr/bin/env bash
# StopFailure hook (matcher: rate_limit) — scenarios rate-limit breadcrumb
# (project-scoped).
#
# Fires when Claude hits a rate limit mid-response. This hook cannot block
# (StopFailure is observational per docs) — it writes a recovery breadcrumb
# to the state file so the next Claude session can read it and resume the
# batch from where the rate limit cut off.
#
# Breadcrumb location:
#   ${CLAUDE_PROJECT_DIR}/tests/scenarios/state/rate-limit-breadcrumb.json
#
# Breadcrumb schema:
#   {
#     "event": "rate_limit",
#     "at": "2026-04-13T22:15:00Z",
#     "batch_state_file": "<path or null>",
#     "hint": "Resume via /run-scenarios-batch <range> — conductor reads batch-state.json"
#   }

set -euo pipefail

# Determine breadcrumb target — project-scoped only, no HOME fallback
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
  # Can't locate the project → nothing to record → fail open
  exit 0
fi
STATE_DIR="${CLAUDE_PROJECT_DIR}/tests/scenarios/state"
mkdir -p "$STATE_DIR"
BREADCRUMB="$STATE_DIR/rate-limit-breadcrumb.json"
BATCH_STATE="$STATE_DIR/batch-state.json"

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BATCH_STATE_REF="null"
[ -f "$BATCH_STATE" ] && BATCH_STATE_REF="\"$BATCH_STATE\""

cat > "$BREADCRUMB" <<EOF
{
  "event": "rate_limit",
  "at": "$NOW",
  "batch_state_file": $BATCH_STATE_REF,
  "hint": "Resume via /run-scenarios-batch <range> — conductor reads batch-state.json (if present) to pick up the exact position, else restarts from the first unfinished scenario in the range. See SCENARIOS_TESTS_RULES.md 'Rate-limit resilience' for details."
}
EOF

# Also log to stderr for observability (StopFailure stderr goes to the Claude log)
echo "[scenarios] rate-limit breadcrumb written: $BREADCRUMB" >&2

exit 0
