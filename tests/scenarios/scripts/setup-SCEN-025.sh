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
