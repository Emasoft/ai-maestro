#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# SCEN-018 fixture cleanup — MAINTAINER lifecycle.
#
# Reverts everything created by setup-SCEN-018.sh and any state
# the scenario mutated during its run. Safe to call multiple times.
#
# Called by run-all-scenarios.sh AFTER the scenario runs. Also
# called during preflight if the harness detects stale state.
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPTS_DIR/fixture-helpers.sh"

log "=== SCEN-018 cleanup ==="

# 1. Delete test agents (registry + tmux + folders)
fixture_delete_agents_by_prefix "scen018-"

# 2. Kill any leftover tmux sessions
fixture_kill_tmux_by_prefix "scen018-"

# 3. Restore state from snapshot if one was saved
snapshot_file="$STATE_DIR/SCEN-018.snapshot"
if [ -f "$snapshot_file" ]; then
    snapshot_dir="$(cat "$snapshot_file")"
    if [ -d "$snapshot_dir" ]; then
        log "state snapshot at $snapshot_dir — comparing current state for drift"
        # Only restore ~/.claude/settings.json if it has drifted
        if [ -f "$snapshot_dir/settings.json.bak" ]; then
            if ! cmp -s "$snapshot_dir/settings.json.bak" "$HOME/.claude/settings.json"; then
                log "settings.json drifted — restoring from snapshot"
                cp "$snapshot_dir/settings.json.bak" "$HOME/.claude/settings.json"
            else
                log "settings.json unchanged — no restore needed"
            fi
        fi
    fi
fi

# 4. Leave fixture GitHub repos in place (they are persistent test
#    fixtures used by multiple runs). To delete them explicitly, run:
#       OVERNIGHT_HARNESS_ALLOW_DELETE=1 bash cleanup-SCEN-018.sh --hard
if [ "${1:-}" = "--hard" ] && [ "${OVERNIGHT_HARNESS_ALLOW_DELETE:-}" = "1" ]; then
    log "--hard flag + allow-delete env var set — deleting fixture repos"
    fixture_github_repo_delete "Emasoft/scen018-test-repo-alpha"
    fixture_github_repo_delete "Emasoft/scen018-test-repo-beta"
fi

log "=== SCEN-018 cleanup complete ==="
