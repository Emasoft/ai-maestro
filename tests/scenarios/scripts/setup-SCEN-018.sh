#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# SCEN-018 fixture setup — MAINTAINER lifecycle.
#
# Creates/refreshes the two fake GitHub test repos the scenario
# expects. Idempotent. Safe to run multiple times.
#
# Invoked by the scenario-batch-runner agent BEFORE driving the
# scenario through Chrome. The matching cleanup-SCEN-018.sh reverts
# everything after the scenario completes.
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPTS_DIR/fixture-helpers.sh"

log "=== SCEN-018 setup ==="

# 1. Provision both fake repos with buggy Python fixtures
fixture_github_repo "Emasoft/scen018-test-repo-alpha" with-buggy-python
fixture_github_repo "Emasoft/scen018-test-repo-beta"  with-buggy-python

# 2. Verify the role-plugin is in the local cache. If not, update the
#    marketplace so the scenario's wizard step can find it.
if ! ls "$HOME/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-maintainer-agent" >/dev/null 2>&1; then
    log "maintainer plugin not in cache — refreshing marketplace"
    claude plugin marketplace update ai-maestro-plugins 2>&1 | tail -2 || true
fi

# 3. Kill any stale scen018-* tmux sessions from a prior run
fixture_kill_tmux_by_prefix "scen018-"

# 4. Delete any orphan agents matching scen018 prefix
fixture_delete_agents_by_prefix "scen018-"

# 5. Snapshot state for Rule 3 STATE-WIPE
ts="$(date +%Y%m%d_%H%M%S)"
snapshot_dir="/Users/emanuelesabetta/ai-maestro/tests/scenarios/state-backups/SCEN-018_${ts}"
fixture_snapshot_aim_state "$snapshot_dir"
echo "$snapshot_dir" > "$STATE_DIR/SCEN-018.snapshot"

log "=== SCEN-018 setup complete — snapshot=$snapshot_dir ==="
