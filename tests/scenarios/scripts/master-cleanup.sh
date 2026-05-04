#!/usr/bin/env bash
# master-cleanup.sh — final phase of an autonomous scenario batch.
#
# Per Rule 13, this runs ONCE at the end of a batch:
#   1. Stop the shared dev-browser daemon for ai-maestro-scenarios.
#   2. Kill any leftover scen-*/cos-scen-*/r17-test-* tmux sessions
#      (the per-scenario cleanup-SCEN-NNN.sh should have handled them, but
#      this is the belt-and-braces sweep).
#   3. Verify no test agents/teams linger in the runtime registry — log
#      anything that escaped per-scenario cleanup so the operator can take
#      corrective action manually.
#   4. Generate the user-facing CONSOLIDATED_PROPOSALS file via the
#      existing generate-consolidated-proposals.sh script.
#   5. Set state.phase = "consolidated".
#
# The caller (cron prompt OR hand-driven orchestrator) is responsible for
# committing the consolidated file. This script does NOT touch git.
#
# Usage:
#   bash tests/scenarios/scripts/master-cleanup.sh
#   bash tests/scenarios/scripts/master-cleanup.sh --dry-run

set -euo pipefail

if MAIN_ROOT="$(git rev-parse --git-common-dir 2>/dev/null)"; then
  MAIN_ROOT="$(cd "$(dirname "$MAIN_ROOT")" && pwd)"
else
  MAIN_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi

STATE_FILE="$MAIN_ROOT/tests/scenarios/state/autonomous-batch-state.json"
SCRIPTS_DIR="$MAIN_ROOT/tests/scenarios/scripts"
DRY_RUN=0
LOG_PREFIX="[master-cleanup]"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "ERROR unknown-arg-$1" >&2; exit 2 ;;
  esac
done

[ -f "$STATE_FILE" ] || { echo "$LOG_PREFIX state-file-missing"; exit 2; }

# Step 1: stop dev-browser
echo "$LOG_PREFIX step 1: stop dev-browser daemon"
if [ "$DRY_RUN" -eq 0 ]; then
  if command -v dev-browser >/dev/null 2>&1; then
    dev-browser stop 2>&1 | sed "s/^/$LOG_PREFIX   /" || true
  else
    echo "$LOG_PREFIX   dev-browser not on PATH (skipping)"
  fi
fi

# Step 2: kill leftover scen-* tmux sessions
echo "$LOG_PREFIX step 2: kill leftover scen-* tmux sessions"
LEFTOVERS="$(tmux list-sessions -F '#S' 2>/dev/null | grep -E '^(scen-|cos-scen-|scen[0-9]+-|r17-test-|.*-jsonl-)' || true)"
if [ -n "$LEFTOVERS" ]; then
  while IFS= read -r SESSION; do
    [ -z "$SESSION" ] && continue
    echo "$LOG_PREFIX   kill: $SESSION"
    if [ "$DRY_RUN" -eq 0 ]; then
      tmux kill-session -t "$SESSION" 2>&1 | sed "s/^/$LOG_PREFIX     /" || true
    fi
  done <<<"$LEFTOVERS"
else
  echo "$LOG_PREFIX   none — clean"
fi

# Step 3: registry sanity check (read-only)
echo "$LOG_PREFIX step 3: scan registry for leftover test artifacts"
REG="$HOME/.aimaestro/agents/registry.json"
if [ -f "$REG" ]; then
  python3 - "$REG" <<'PYEOF'
import json, sys, re
with open(sys.argv[1]) as f:
    reg = json.load(f)
agents = reg.get("agents", []) if isinstance(reg, dict) else reg
TEST_PATTERN = re.compile(r"^(scen-?\d+|scen-|cos-scen-|r17-test-)", re.IGNORECASE)
leftover = [a for a in agents if isinstance(a, dict) and TEST_PATTERN.match(a.get("name") or "")]
if leftover:
    for a in leftover:
        print(f"[master-cleanup]   LINGERING_TEST_AGENT name={a.get('name')} id={a.get('id')} workdir={a.get('workingDirectory')}")
else:
    print("[master-cleanup]   no lingering test agents")
PYEOF
else
  echo "$LOG_PREFIX   registry.json not found at $REG (skipping)"
fi

# Step 4: generate consolidated proposals
echo "$LOG_PREFIX step 4: generate consolidated proposals"
if [ "$DRY_RUN" -eq 0 ]; then
  bash "$SCRIPTS_DIR/generate-consolidated-proposals.sh" 2>&1 | sed "s/^/$LOG_PREFIX   /" || {
    echo "$LOG_PREFIX   ERROR generate-consolidated-proposals failed"
    exit 1
  }
fi

# Step 5: phase = consolidated
echo "$LOG_PREFIX step 5: advance state phase to consolidated"
if [ "$DRY_RUN" -eq 0 ]; then
  python3 - "$STATE_FILE" <<'PYEOF'
import json, os, sys, datetime
sf = sys.argv[1]
with open(sf) as f:
    s = json.load(f)
s["phase"] = "consolidated"
s["completed_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
tmp = sf + ".tmp"
with open(tmp, "w") as f:
    json.dump(s, f, indent=2)
    f.write("\n")
os.replace(tmp, sf)
PYEOF
fi

echo "$LOG_PREFIX done"
