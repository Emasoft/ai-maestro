#!/usr/bin/env bash
# SCEN-018 cleanup — MAINTAINER lifecycle.
#
# Step 1: SCEN-018 custom extras — remove test agents/tmux sessions.
# Step 2: shared rewipe-list restore (from scenario frontmatter).
#
# Fixture GitHub repos are left in place as persistent fixtures. Pass --hard
# (with OVERNIGHT_HARNESS_ALLOW_DELETE=1) to delete them explicitly.

set -eu
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fixture-helpers.sh
source "$SCRIPTS_DIR/fixture-helpers.sh"

log "=== SCEN-018 cleanup ==="

# Step 1: SCEN-018-specific cleanup.
fixture_delete_agents_by_prefix "scen018-"
fixture_kill_tmux_by_prefix "scen018-"

if [ "${1:-}" = "--hard" ] && [ "${OVERNIGHT_HARNESS_ALLOW_DELETE:-}" = "1" ]; then
    log "--hard flag + allow-delete env var set — deleting fixture repos"
    fixture_github_repo_delete "Emasoft/scen018-test-repo-alpha"
    fixture_github_repo_delete "Emasoft/scen018-test-repo-beta"
fi

# Step 2: shared rewipe-list restore with SHA256 verification.
"$SCRIPTS_DIR/scenario-restore.sh" 018

log "=== SCEN-018 cleanup complete ==="
