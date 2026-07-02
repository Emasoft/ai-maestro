#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# kill-orphans.sh — one-shot cleanup of stale scenario state.
#
# Called manually before launching a new overnight batch, or
# automatically by run-all-scenarios.sh during preflight.
#
# Kills stale tmux sessions, deletes orphan agents via API, and
# purges cemetery entries. Leaves the _aim-placeholder session
# alive so the tmux server stays running.
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPTS_DIR/fixture-helpers.sh"

log "=== kill-orphans ==="

# Stale tmux sessions — everything starting with scen, cos-scen, test-, SCEN-
fixture_kill_tmux_by_prefix "scen0"
fixture_kill_tmux_by_prefix "scen1"
fixture_kill_tmux_by_prefix "SCEN-"
fixture_kill_tmux_by_prefix "cos-scen"
fixture_kill_tmux_by_prefix "test-"

# Orphan agents via API
fixture_delete_agents_by_prefix "scen0"
fixture_delete_agents_by_prefix "scen1"
fixture_delete_agents_by_prefix "SCEN-"
fixture_delete_agents_by_prefix "test-"

# Ensure the placeholder is alive so the tmux server doesn't exit
tmux has-session -t _aim-placeholder 2>/dev/null || tmux new-session -d -s _aim-placeholder

log "=== kill-orphans done ==="
