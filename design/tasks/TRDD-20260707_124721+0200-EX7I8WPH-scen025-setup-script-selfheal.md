---
trdd-id: EX7I8WPH
title: Rewrite setup-SCEN-025.sh to self-heal its GitHub fixtures
column: planned
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: [25]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-EX7I8WPH — Rewrite setup-SCEN-025.sh to self-heal its GitHub fixtures

## Problem
`tests/scenarios/scripts/setup-SCEN-025.sh` is confirmed at HEAD
(2026-07-07) to still be the generic 6-line wrapper:

```bash
#!/usr/bin/env bash
# Per-scenario setup wrapper — delegates to shared scenario-setup.sh.
# Reads frontmatter fields rewipe-list / git-fixtures / dir-fixtures from
# tests/scenarios/SCEN-025_*.scen.md and executes the shared setup logic.
exec "$(dirname "$0")/scenario-setup.sh" 025 "$@"
```

This hands fixture preparation entirely to "the scenario author prepares
this in advance" (per the scenario's own `prerequisites:` field) with no
actual provisioning code. If the fixture repo, Project board, or local
clone are ever deleted (manual cleanup between batch runs, account
migration, etc.), every subsequent SCEN-025 run SETUP_FAILs with no
recovery path.

## Root cause
`setup-SCEN-018.sh` (a comparable scenario with GitHub-repo fixtures)
calls `fixture_github_repo` from `fixture-helpers.sh` to idempotently
(re)create its fixture. `setup-SCEN-025.sh` was never given the
equivalent treatment because, at authoring time, no Project-board helper
existed (see TRDD-TC8TBJEU) and no follow-up ever closed the gap.

## Proposed fix
Once TRDD-TC8TBJEU's `fixture_github_project_v2` helper and
TRDD-QB5PWIG3's one-time fixture provisioning have both landed, rewrite
`tests/scenarios/scripts/setup-SCEN-025.sh`:

```bash
#!/usr/bin/env bash
# SCEN-025 setup — Kanban with GitHub Project sync.
#
# Step 1: shared rewipe-list/fixtures (from scenario frontmatter).
# Step 2: SCEN-025 custom extras — provision GitHub repo + Project board,
#         configure Status field columns (ratified TRDD column: vocabulary,
#         see TRDD-TC8TBJEU), link them, prepare the local clone.

set -eu
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: shared backups + fixture checks
"$SCRIPTS_DIR/scenario-setup.sh" 025 "$@" || true   # may complain about
                                                     # missing local clone — we
                                                     # bootstrap it below

# Step 2: SCEN-025-specific extras.
# shellcheck source=fixture-helpers.sh
source "$SCRIPTS_DIR/fixture-helpers.sh"
log "=== SCEN-025 custom extras ==="

# 2a. Provision the empty fixture repo (idempotent).
fixture_github_repo "Emasoft/scen025-kanban-fixture" empty

# 2b. Ensure local clone exists with scenario-start tag.
FIXTURE_LOCAL="$PROJECT_ROOT/tests/scenarios/fixtures/git/scen025-kanban-fixture"
if [ ! -d "$FIXTURE_LOCAL/.git" ]; then
    log "cloning fixture into $FIXTURE_LOCAL"
    git clone --quiet "https://github.com/Emasoft/scen025-kanban-fixture.git" "$FIXTURE_LOCAL"
fi
if ! git -C "$FIXTURE_LOCAL" rev-parse --verify scenario-start >/dev/null 2>&1; then
    log "tagging scenario-start in $FIXTURE_LOCAL"
    git -C "$FIXTURE_LOCAL" tag scenario-start
    git -C "$FIXTURE_LOCAL" push origin scenario-start
fi
git -C "$FIXTURE_LOCAL" reset --hard scenario-start
git -C "$FIXTURE_LOCAL" clean -fdx

# 2c. Provision the Project board (ratified 17-column vocabulary, see
#     TRDD-TC8TBJEU — this call relies on that helper's default columns).
PROJECT_NUM=$(fixture_github_project_v2 Emasoft "SCEN-025 Fixture Board")
log "fixture Project board is number $PROJECT_NUM"
echo "$PROJECT_NUM" > "$STATE_DIR/scen025-project-number"

# 2d. Link the Project to the repo (idempotent — gh project link errors on
#     duplicate are ignored).
gh project link "$PROJECT_NUM" --owner Emasoft \
    --url "https://github.com/Emasoft/scen025-kanban-fixture" 2>/dev/null || true

# 2e. Kill stale tmux sessions + orphan agents from prior runs.
fixture_kill_tmux_by_prefix "scen025-"
fixture_kill_tmux_by_prefix "cos-scen025-"
fixture_delete_agents_by_prefix "scen025-"

log "=== SCEN-025 setup complete (project=$PROJECT_NUM) ==="
```

The scenario runner reads `tests/scenarios/state/scen025-project-number`
to obtain the dynamic project number to feed into S011 (replacing the
hardcoded literal that TRDD-8W16AN6X removes from the scenario prose).

**File to edit:** `tests/scenarios/scripts/setup-SCEN-025.sh` (full rewrite).

## Verification
First run after this fix should print `=== SCEN-025 setup complete
(project=N) ===` and exit 0. A second run on the same machine should be
idempotent — no new repos or projects created, same project number
returned.

## Estimated risk
LOW, but this proposal has hard prerequisites: it cannot be implemented
before TRDD-TC8TBJEU (the helper it calls) and TRDD-QB5PWIG3 (the
one-time fixture it assumes already exists) land.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Sequenced AFTER TC8TBJEU.
