#!/usr/bin/env bash
# state-machine-tick.sh — single source of truth for the autonomous batch state machine.
#
# Reads tests/scenarios/state/autonomous-batch-state.json, applies one tick of the
# state machine, and prints what to do next on stdout. Idempotent — safe to call
# many times in a row, or from a cron, or from the run-scenarios-batch skill.
#
# Output format (one line on stdout):
#   RUN <SCEN-NNN>          — dispatch this scenario via the scenario-runner agent
#   CLEANUP                 — phase=master_cleanup, run consolidated proposals
#   DONE                    — phase=consolidated, nothing to do
#   WAIT <SCEN-NNN>         — that scenario's heartbeat is fresh (in_progress), OR
#                             it is fixture-blocked (preflight_skipped) — leave it alone
#   ERROR <reason>          — state file unreadable / corrupt / something is wrong
#
# Side effects (idempotent):
#   - If an in_progress scenario's heartbeat is stale (>STALE_THRESHOLD_MIN old, or
#     no heartbeat file exists and started_at is >STALE_THRESHOLD_MIN ago), the
#     scenario is reset to pending so the next caller can dispatch it fresh.
#   - Every pending/preflight_skipped scenario gets a fixture-existence preflight
#     (TRDD-QE1J5C91) on each tick: a scenario whose git-fixtures/dir-fixtures
#     aren't cloned/present is flipped to "preflight_skipped" so Step 3 skips it
#     instead of dispatching a guaranteed setup-then-fail cycle; it flips back to
#     "pending" automatically the moment its fixture appears on disk.
#   - The recovery event is logged to state/recovery.log with timestamp + reason.
#
# Usage:
#   bash tests/scenarios/scripts/state-machine-tick.sh
#   bash tests/scenarios/scripts/state-machine-tick.sh --dry-run        # no mutations
#   bash tests/scenarios/scripts/state-machine-tick.sh --stale-min 90   # override threshold

set -euo pipefail

# ---- Resolve project root (worktree-safe) ----
if MAIN_ROOT="$(git rev-parse --git-common-dir 2>/dev/null)"; then
  MAIN_ROOT="$(cd "$(dirname "$MAIN_ROOT")" && pwd)"
else
  MAIN_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi

SCEN_ROOT="$MAIN_ROOT/tests/scenarios"
STATE_DIR="$SCEN_ROOT/state"
STATE_FILE="$STATE_DIR/autonomous-batch-state.json"
RECOVERY_LOG="$STATE_DIR/recovery.log"
STALE_THRESHOLD_MIN=90
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --stale-min) STALE_THRESHOLD_MIN="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    *) echo "ERROR unknown-arg-$1" ; exit 2 ;;
  esac
done

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR state-file-missing"
  exit 2
fi

# ---- Helper: write recovery log entry ----
log_recovery() {
  local msg="$1"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >> "$RECOVERY_LOG"
}

# ---- Helper: per-scenario fixture-existence preflight (TRDD-QE1J5C91) ----
# Usage: preflight_scenario <NNN>   (e.g. "025")
# Checks ONLY that every git-fixtures/dir-fixtures path already exists on
# disk — it does NOT run the scenario's real setup script. This lets the
# dispatch loop below skip a scenario whose fixtures were never cloned
# instead of burning a cron slot on a guaranteed setup-then-fail cycle.
# Prints "PREFLIGHT_FAIL SCEN-<nnn> — <reason>" and returns 1 on failure;
# returns 0 silently on success (or when yq is unavailable — fail OPEN so a
# missing optional dependency never blocks every scenario in the batch).
preflight_scenario() {
  local nnn="$1"
  local scen_file
  scen_file=$(ls "$SCEN_ROOT/SCEN-${nnn}_"*.scen.md 2>/dev/null | head -1)
  if [ ! -f "$scen_file" ]; then
    echo "PREFLIGHT_FAIL SCEN-$nnn — scenario file not found"
    return 1
  fi
  if ! command -v yq >/dev/null 2>&1; then
    return 0
  fi

  local fm
  fm=$(awk '/^---$/{c++; if(c==2) exit; next} c==1' "$scen_file")

  local git_fixtures dir_fixtures
  git_fixtures=$(echo "$fm" | yq e '.["git-fixtures"][]? // ""' - 2>/dev/null || echo "")
  dir_fixtures=$(echo "$fm" | yq e '.["dir-fixtures"][]? // ""' - 2>/dev/null || echo "")

  local url owner repo repo_name local_path
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    # Same <owner>__<repo> derivation as scenario-setup.sh (TRDD-4TKDCKD5) —
    # keeping the two in sync avoids the preflight wrongly reporting a
    # fixture missing when it actually lives at the collision-safe path.
    if [[ "$url" =~ github\.com/([^/]+)/([^/]+)$ ]]; then
      owner="${BASH_REMATCH[1]}"
      repo="${BASH_REMATCH[2]%.git}"
      repo_name="${owner}__${repo}"
    else
      repo_name=$(basename "$url" .git)
    fi
    local_path="$SCEN_ROOT/fixtures/git/$repo_name"
    if [ ! -d "$local_path/.git" ]; then
      echo "PREFLIGHT_FAIL SCEN-$nnn — git-fixture $url not cloned (expected $local_path)"
      return 1
    fi
  done <<< "$git_fixtures"

  local p p_exp
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    case "$p" in
      '~')   p_exp="$HOME" ;;
      '~/'*) p_exp="${HOME}/${p#'~/'}" ;;
      *)     p_exp="$p" ;;
    esac
    if [ ! -d "$p_exp" ]; then
      echo "PREFLIGHT_FAIL SCEN-$nnn — dir-fixture $p_exp missing"
      return 1
    fi
  done <<< "$dir_fixtures"

  return 0
}

# ---- Helper: atomically set one scenario's status in the state file ----
# Usage: set_scenario_status <scen_id> <new_status> [reason]
set_scenario_status() {
  local scen_id="$1" new_status="$2" reason="${3:-}"
  python3 - "$STATE_FILE" "$scen_id" "$new_status" "$reason" <<'PYEOF'
import json, os, sys, datetime
state_file, scen_id, new_status, reason = sys.argv[1:5]
with open(state_file) as f:
    state = json.load(f)
entry = state.setdefault("scenarios", {}).setdefault(scen_id, {})
entry["status"] = new_status
if reason:
    entry["preflight_reason"] = reason
    entry["preflight_checked_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
else:
    entry.pop("preflight_reason", None)
    entry.pop("preflight_checked_at", None)
tmp = state_file + ".tmp"
with open(tmp, "w") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
os.replace(tmp, state_file)
PYEOF
}

# ---- Step 1: validate JSON and read phase ----
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$STATE_FILE" 2>/dev/null; then
  echo "ERROR state-file-corrupt"
  exit 2
fi

PHASE="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('phase',''))" "$STATE_FILE")"

case "$PHASE" in
  consolidated|failed)
    echo "DONE"
    exit 0
    ;;
  master_cleanup)
    echo "CLEANUP"
    exit 0
    ;;
  master_setup|running) ;;
  *)
    echo "ERROR unknown-phase-$PHASE"
    exit 2
    ;;
esac

# ---- Step 2: detect stale in_progress and reset to pending ----
NOW_EPOCH="$(date -u +%s)"
STALE_THRESHOLD_SEC=$((STALE_THRESHOLD_MIN * 60))

# Use python to avoid jq dependency. Read state, detect stale, optionally rewrite.
python3 - "$STATE_FILE" "$STATE_DIR" "$NOW_EPOCH" "$STALE_THRESHOLD_SEC" "$DRY_RUN" "$RECOVERY_LOG" <<'PYEOF'
import json, os, sys, time, datetime

state_file, state_dir, now_epoch_s, stale_threshold_s, dry_run_s, recovery_log = sys.argv[1:]
now_epoch = int(now_epoch_s)
stale_threshold = int(stale_threshold_s)
dry_run = dry_run_s == "1"

with open(state_file, "r") as f:
    state = json.load(f)

mutated = False
recovery_entries = []

def parse_iso(ts):
    if not ts:
        return None
    # Accept either Z or +HHMM offset
    try:
        s = ts.replace("Z", "+00:00")
        return datetime.datetime.fromisoformat(s).timestamp()
    except Exception:
        return None

for scen_id, entry in state.get("scenarios", {}).items():
    if entry.get("status") != "in_progress":
        continue

    # Try heartbeat file first (most authoritative)
    hb_path = os.path.join(state_dir, f"runner-heartbeat-{scen_id}.txt")
    hb_age = None
    if os.path.exists(hb_path):
        try:
            with open(hb_path, "r") as f:
                first_line = f.readline().strip()
            # Format: "epoch=1777950000" or just an integer
            if first_line.startswith("epoch="):
                hb_epoch = int(first_line.split("=", 1)[1])
            else:
                hb_epoch = int(first_line)
            hb_age = now_epoch - hb_epoch
        except Exception:
            hb_age = None

    # Fall back to started_at
    started_age = None
    started_ts = parse_iso(entry.get("started_at"))
    if started_ts is not None:
        started_age = now_epoch - int(started_ts)

    # Decide staleness
    is_stale = False
    reason = ""
    if hb_age is not None:
        if hb_age > stale_threshold:
            is_stale = True
            reason = f"heartbeat {hb_age}s old (>{stale_threshold}s threshold)"
    elif started_age is not None:
        if started_age > stale_threshold:
            is_stale = True
            reason = f"no heartbeat, started {started_age}s ago (>{stale_threshold}s threshold)"
    else:
        is_stale = True
        reason = "no heartbeat and no started_at"

    if is_stale:
        if not dry_run:
            entry["status"] = "pending"
            entry["started_at"] = None
            # Bump retry counter for visibility
            entry["retries"] = entry.get("retries", 0) + 1
            entry["last_stuck_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
            entry["last_stuck_reason"] = reason
            # Remove the stale heartbeat file
            try:
                if os.path.exists(hb_path):
                    os.remove(hb_path)
            except Exception:
                pass
            mutated = True
        recovery_entries.append((scen_id, reason))

# Atomic write
if mutated and not dry_run:
    tmp = state_file + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")
    os.replace(tmp, state_file)

# Append recovery log
if recovery_entries and not dry_run:
    with open(recovery_log, "a") as f:
        ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        for scen_id, reason in recovery_entries:
            f.write(f"{ts} STALE_RESET {scen_id} {reason}\n")

# Print recovery summary to stderr (so stdout stays clean for caller)
for scen_id, reason in recovery_entries:
    print(f"recovered: {scen_id} ({reason})", file=sys.stderr)
PYEOF

# ---- Step 2b: per-scenario fixture preflight (TRDD-QE1J5C91) ----
# Every "pending" scenario, plus every previously "preflight_skipped" one
# (so it can self-heal the moment its fixture is cloned), is re-checked on
# each tick. A scenario that fails the check is flipped to
# "preflight_skipped" instead of being handed to Step 3 for dispatch — this
# is what stops the batch from burning a cron fire (and the scenario's full
# setup-then-fail cycle) on a guaranteed-broken scenario.
if [ "$DRY_RUN" -eq 0 ]; then
  CANDIDATES="$(python3 - "$STATE_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
scenarios = state.get("scenarios", {})
order = state.get("scenario_list", list(scenarios.keys()))
for scen_id in order:
    st = scenarios.get(scen_id, {}).get("status")
    if st in ("pending", "preflight_skipped"):
        print(f"{scen_id}\t{st}")
PYEOF
)"
  while IFS=$'\t' read -r scen_id prev_status; do
    [ -z "$scen_id" ] && continue
    nnn="${scen_id#SCEN-}"
    if preflight_out="$(preflight_scenario "$nnn")"; then
      if [ "$prev_status" = "preflight_skipped" ]; then
        set_scenario_status "$scen_id" "pending"
        log_recovery "PREFLIGHT_RECOVERED $scen_id fixtures now present"
      fi
    else
      if [ "$prev_status" != "preflight_skipped" ]; then
        set_scenario_status "$scen_id" "preflight_skipped" "$preflight_out"
        log_recovery "PREFLIGHT_SKIPPED $scen_id — $preflight_out"
      fi
    fi
  done <<< "$CANDIDATES"
fi

# ---- Step 3: determine next action ----
NEXT="$(python3 - "$STATE_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
scenarios = state.get("scenarios", {})
order = state.get("scenario_list", list(scenarios.keys()))

# Already in_progress (fresh heartbeat) → WAIT
for scen_id in order:
    e = scenarios.get(scen_id, {})
    if e.get("status") == "in_progress":
        print(f"WAIT {scen_id}")
        sys.exit(0)

# Otherwise, find first pending
for scen_id in order:
    e = scenarios.get(scen_id, {})
    if e.get("status") == "pending":
        print(f"RUN {scen_id}")
        sys.exit(0)

# Nothing pending and nothing running — but if some scenarios are only
# fixture-blocked (preflight_skipped, TRDD-QE1J5C91), the batch is NOT done
# yet: those scenarios self-heal back to "pending" the moment their fixture
# appears (Step 2b), so declaring CLEANUP here would end the batch while
# real, still-runnable work is sitting fixture-blocked. WAIT on the first
# one instead — the cron leaves it alone, same as an in_progress WAIT.
for scen_id in order:
    e = scenarios.get(scen_id, {})
    if e.get("status") == "preflight_skipped":
        print(f"WAIT {scen_id}")
        sys.exit(0)

# Nothing pending, nothing running, nothing fixture-blocked — time for cleanup
print("CLEANUP")
PYEOF
)"

# ---- Step 4: if we returned CLEANUP, advance phase=running → master_cleanup ----
if [ "$NEXT" = "CLEANUP" ] && [ "$PHASE" = "running" ] && [ "$DRY_RUN" -eq 0 ]; then
  python3 - "$STATE_FILE" <<'PYEOF'
import json, sys, os
with open(sys.argv[1]) as f:
    state = json.load(f)
state["phase"] = "master_cleanup"
tmp = sys.argv[1] + ".tmp"
with open(tmp, "w") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
os.replace(tmp, sys.argv[1])
PYEOF
  log_recovery "PHASE_ADVANCE running -> master_cleanup"
fi

echo "$NEXT"
