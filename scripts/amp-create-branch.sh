#!/usr/bin/env bash
# =============================================================================
# AMP Create Branch - Create and push a new git branch
# =============================================================================
#
# Create a new branch in a git repository and push it to origin.
#
# Usage:
#   amp-create-branch.sh <repo-path> <branch-name>
#
# Examples:
#   amp-create-branch.sh /path/to/repo feature/new-api
#   amp-create-branch.sh . fix/login-bug
#
# =============================================================================

set -eo pipefail

# SCRIPT-MANIFEST.md §6.4: `--help` is a LOCAL, OFFLINE operation and exits 0.
# This script had no --help verb at all, so the flag was read as <repo-path> and
# fell through to the usage line below at exit 1 — a caller asking what the script
# does got the same signal as a caller who used it wrong (TRDD-3KJW8P6R).
case "${1:-}" in
  --help|-h)
    cat <<'EOF'
Usage: amp-create-branch.sh <repo-path> <branch-name>

Create a branch in a local git repository and push it, setting upstream.

  <repo-path>     path to a local git repository (must contain .git)
  <branch-name>   the branch to create

Exit: 0 on success · non-zero with a reason on stderr otherwise.
EOF
    exit 0
    ;;
esac

REPO_PATH="${1:-}"
BRANCH_NAME="${2:-}"

if [ -z "$REPO_PATH" ] || [ -z "$BRANCH_NAME" ]; then
  echo "Usage: amp-create-branch.sh <repo-path> <branch-name>" >&2
  exit 1
fi

if [ ! -d "$REPO_PATH/.git" ]; then
  echo "Error: $REPO_PATH is not a git repository" >&2
  exit 1
fi

cd "$REPO_PATH"
git checkout -b "$BRANCH_NAME"
git push -u origin "$BRANCH_NAME"
echo "Branch '$BRANCH_NAME' created and pushed"
