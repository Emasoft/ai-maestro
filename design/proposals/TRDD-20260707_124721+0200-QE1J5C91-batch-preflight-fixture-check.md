---
trdd-id: QE1J5C91
title: Add per-scenario fixture-existence preflight to the batch runner
column: proposal
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T12:47:21+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: M
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-QE1J5C91 — Add per-scenario fixture-existence preflight to the batch runner

## Problem
When a scenario like SCEN-025 has missing `git-fixtures`/`dir-fixtures`
infrastructure, the orchestrator only discovers this AFTER dispatching
the scenario and running its full setup — burning a batch slot (and
several seconds to minutes of setup work) before failing. In a long
overnight batch, a scenario buried deep in `scenario_list` wastes a cron
fire on a guaranteed backup-then-fail instead of that slot going to a
runnable scenario.

Note: `.claude/skills/run-scenarios-batch/references/procedure-details.md`
already documents an OPTIONAL "Step 2 — Optional preflight" that reads
`tests/scenarios/scenarios.config.json` for a `preflight_command` (a
single shell command run once before the whole batch) and a `base_url`
health check. That existing mechanism is batch-wide and generic — it
does not inspect any individual scenario's `git-fixtures`/`dir-fixtures`
frontmatter. This proposal is a distinct, per-scenario check, not a
duplicate of the existing batch-level health probe.

## Root cause
No per-scenario validation step exists between "batch decides which
scenario to run next" and "scenario's own setup script runs and
potentially fails on a missing fixture."

## Proposed fix
Before transitioning `phase=master_setup -> phase=running` (or as an
early step inside `tests/scenarios/scripts/state-machine-tick.sh`'s
dispatch logic), run a fast preflight for each pending scenario that
checks only fixture-existence (not full setup):

```bash
preflight_scenario() {
    local nnn="$1"
    local scen_file
    scen_file=$(ls "tests/scenarios/SCEN-${nnn}_"*.scen.md | head -1)
    # parse git-fixtures from frontmatter, verify each has a local clone
    while IFS= read -r url; do
        [ -z "$url" ] && continue
        local repo_name
        repo_name=$(basename "$url" .git)
        local local_path="tests/scenarios/fixtures/git/$repo_name"
        if [ ! -d "$local_path/.git" ]; then
            echo "PREFLIGHT_FAIL SCEN-$nnn — $url not cloned"
            return 1
        fi
    done <<< "$(parse_list_field "$scen_file" git-fixtures)"
    # parse dir-fixtures similarly, verifying each path exists
    return 0
}
```

Mark a scenario whose preflight fails as `status: preflight_skipped` (a
distinct value from `pending`/`in_progress`/`done`) in
`autonomous-batch-state.json` so the cron's dispatch logic
(`state-machine-tick.sh`) skips it and moves to the next pending
scenario. Log the skip reason into the batch summary so it's visible
without re-running the scenario.

**File to edit:** `tests/scenarios/scripts/state-machine-tick.sh` (add the
preflight check to the dispatch path) and
`.claude/skills/run-scenarios-batch/references/procedure-details.md`
(document the new per-scenario check alongside the existing batch-wide
Step 2 preflight, making clear the two are complementary, not
duplicative).

## Verification
When a scenario's git-fixture is not cloned, the next batch run reports
"SCEN-NNN PREFLIGHT_SKIPPED — git-fixture not cloned" in the batch
summary instead of consuming a cron slot dispatching the scenario and
waiting for its setup script to fail.

## Estimated risk
LOW-MEDIUM — touches the batch state machine's dispatch logic
(`state-machine-tick.sh`), which is load-bearing infrastructure for every
scenario in a batch, not just SCEN-025. Needs a test run against a batch
with at least one deliberately-broken fixture before trusting it in an
unattended overnight run.

## Approval log
