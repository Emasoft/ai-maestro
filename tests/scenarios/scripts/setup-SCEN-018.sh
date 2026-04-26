#!/usr/bin/env bash
# SCEN-018 setup — MAINTAINER lifecycle.
#
# Step 1: shared rewipe-list/fixtures (from scenario frontmatter).
# Step 2: SCEN-018 custom extras — GitHub fake repos, tmux/agent cleanup,
#         marketplace cache refresh.

set -eu
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: shared backups + fixture checks driven by frontmatter.
"$SCRIPTS_DIR/scenario-setup.sh" 018 "$@"

# Step 2: SCEN-018-specific extras.
# shellcheck source=fixture-helpers.sh
source "$SCRIPTS_DIR/fixture-helpers.sh"
log "=== SCEN-018 custom extras ==="

# Provision both fake GitHub repos with buggy Python fixtures (idempotent).
fixture_github_repo "Emasoft/scen018-test-repo-alpha" with-buggy-python
fixture_github_repo "Emasoft/scen018-test-repo-beta"  with-buggy-python

# Refresh marketplace cache if the maintainer role-plugin isn't present.
if ! ls "$HOME/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-maintainer-agent" >/dev/null 2>&1; then
    log "maintainer plugin not in cache — refreshing marketplace"
    claude plugin marketplace update ai-maestro-plugins 2>&1 | tail -2 || true
fi

# Kill stale tmux sessions + orphan agents from prior runs.
fixture_kill_tmux_by_prefix "scen018-"
fixture_delete_agents_by_prefix "scen018-"

log "=== SCEN-018 setup complete ==="
