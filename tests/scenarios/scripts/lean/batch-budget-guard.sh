#!/usr/bin/env bash
# batch-budget-guard.sh — the scenario-batch token kill-switch (TRDD-TBGGUA2V).
#
# THE CONTRACT: the batch (run-scenarios-batch skill / Rule-13 cron /
# state-machine-tick.sh / any code that dispatches a scenario-runner) MUST call
# this guard and get exit 0 BEFORE launching each scenario. Any non-zero exit
# means HALT — do not launch.  This exists so a runaway batch can never repeat
# the week-of-tokens Opus blowup: two independent enable gates, a scenario
# count cap, a wall-clock deadline, and an instant manual STOP sentinel.
#
# Usage:
#   batch-budget-guard.sh check <completed_count>   # exit 0 = ok to launch next
#   batch-budget-guard.sh arm   <max_hours>          # set enabled + a fresh deadline
#   batch-budget-guard.sh validate <tokens_per_scenario>  # record validation, set validated=true
#   batch-budget-guard.sh stop                       # drop the STOP sentinel (instant halt)
#   batch-budget-guard.sh status
#
# Pure bash + python3 for JSON (no jq dependency). Fail-CLOSED: any error,
# missing file, or unparsable config = HALT (exit 1). A guard that fails open
# would defeat its own purpose.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"   # repo root
STATE_DIR="$ROOT/tests/scenarios/state"
CFG="$STATE_DIR/batch-budget.json"
STOP="$STATE_DIR/STOP"

die() { echo "GUARD halt: $*" >&2; exit 1; }     # fail-closed
ok()  { echo "GUARD ok: $*"; exit 0; }

[ -f "$CFG" ] || die "no batch-budget.json (config missing → fail closed)"

# read a scalar field from the JSON via python3; '' if null/absent
field() { python3 -c "import json,sys;d=json.load(open('$CFG'));v=d.get('$1');print('' if v is None else v)" 2>/dev/null; }

cmd="${1:-status}"

case "$cmd" in
  check)
    completed="${2:-0}"
    [ -e "$STOP" ] && die "STOP sentinel present ($STOP) — manual halt"
    [ "$(field enabled)"   = "True" ] || die "enabled=false (batch is off)"
    [ "$(field validated)" = "True" ] || die "validated=false (per-scenario cost not yet measured)"
    deadline="$(field wall_clock_deadline_epoch)"
    [ -n "$deadline" ] || die "no wall_clock_deadline_epoch set (run not armed)"
    now="$(date +%s)"
    [ "$now" -lt "$deadline" ] || die "past wall-clock deadline ($now >= $deadline)"
    maxn="$(field max_scenarios_per_run)"
    [ -n "$maxn" ] || die "no max_scenarios_per_run set"
    [ "$completed" -lt "$maxn" ] || die "scenario cap reached ($completed >= $maxn)"
    ok "completed=$completed/$maxn, $(( (deadline-now)/60 )) min left"
    ;;
  arm)
    hours="${2:-$(field wall_clock_max_hours)}"; hours="${hours:-8}"
    deadline=$(( $(date +%s) + hours*3600 ))
    python3 - "$CFG" "$deadline" <<'PY'
import json,sys
p,dl=sys.argv[1],int(sys.argv[2])
d=json.load(open(p)); d["enabled"]=True; d["wall_clock_deadline_epoch"]=dl
json.dump(d,open(p,"w"),indent=2)
print("armed: enabled=true deadline_epoch=%d"%dl)
PY
    ;;
  validate)
    toks="${2:?usage: validate <tokens_per_scenario>}"
    python3 - "$CFG" "$toks" <<'PY'
import json,sys
p,t=sys.argv[1],int(sys.argv[2])
d=json.load(open(p)); d["validated"]=True; d["validated_per_scenario_tokens"]=t
json.dump(d,open(p,"w"),indent=2)
print("validated: per_scenario_tokens=%d"%t)
PY
    ;;
  stop)
    date +%s > "$STOP"; echo "STOP sentinel written: $STOP (batch will halt before next scenario)";;
  status)
    echo "cfg=$CFG"
    for k in enabled validated validated_per_scenario_tokens max_scenarios_per_run wall_clock_deadline_epoch hard_token_ceiling_per_run; do
      echo "  $k = $(field "$k")"
    done
    [ -e "$STOP" ] && echo "  STOP = PRESENT" || echo "  STOP = absent"
    ;;
  *) die "unknown command '$cmd' (check|arm|validate|stop|status)";;
esac
