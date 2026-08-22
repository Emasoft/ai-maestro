#!/bin/bash
# Update-safety guard for `update-aimaestro.sh` — TRDD-0N792LL5.
#
# WHY THIS IS ITS OWN FILE. The guard used to be three statements buried in a 400-line installer
# that fetches, pulls, restarts pm2 and reinstalls plugins. Nothing could drive it, so nothing did,
# and the hazard below sat unnoticed until someone read the script by hand. Extracted so a fixture
# repo can exercise it directly (`tests/unit/update-remote-guard.test.ts`); the installer sources
# it and calls `assert_update_safe`.
#
# THE HAZARD IT CLOSES. On a fork-based checkout `origin` is the UPSTREAM we do not publish to,
# so the old sequence -- `git checkout main` (unprompted under NON_INTERACTIVE), `git fetch origin
# main`, `git pull origin main` -- abandoned the working branch and merged a foreign repo over
# work that exists only on this disk. Measured on this machine 2026-08-22: `origin` =
# 23blocks-OS/ai-maestro, and HEAD is 89 commits ahead of fork/main with 0 behind.
#
# The installer's existing stash prompt does NOT cover this. Stashing protects a DIRTY TREE;
# unpushed work is COMMITTED, so it is invisible to that check — which is exactly why the hazard
# reads as already-handled to anyone skimming the file.

# Which remote does a "full update" pull from?
#
# Explicit operator choice wins; otherwise prefer `fork` when it exists. Falling back to `origin`
# is allowed ONLY because `assert_update_safe` re-checks it against the upstream URL — resolution
# and refusal are deliberately separate so neither has to guess the other's job.
resolve_update_remote() {
    if [ -n "${AIM_UPDATE_REMOTE:-}" ]; then
        printf '%s\n' "$AIM_UPDATE_REMOTE"
        return 0
    fi
    if git remote get-url fork >/dev/null 2>&1; then
        printf 'fork\n'
        return 0
    fi
    printf 'origin\n'
}

# Is $1 the upstream repository we do not publish to?
#
# FAILS CLOSED: an unresolvable remote, or an unset AI_MAESTRO_REPO, answers YES. A "no" here
# authorizes a merge, so the answer given when we cannot tell must be the one that refuses. The
# constant comes from scripts/ecosystem-config.sh — never re-spelled here, or this file becomes a
# second place the upstream URL has to be kept correct.
remote_is_upstream() {
    local remote="$1" url upstream
    upstream="${AI_MAESTRO_REPO:-}"
    [ -n "$upstream" ] || return 0
    url="$(git remote get-url "$remote" 2>/dev/null)" || return 0
    # Compare bare identity: a remote is the same repo whether or not it carries .git or a slash.
    url="${url%.git}"; url="${url%/}"
    upstream="${upstream%.git}"; upstream="${upstream%/}"
    [ "$url" = "$upstream" ]
}

# How many commits does HEAD hold that <remote>/<branch> does not?
#
# Prints a count, or `unknown` when the ref cannot be resolved (never 0 — see assert_update_safe:
# a 0 here would authorize the merge, so the un-measurable case must be distinguishable from the
# measured-safe one).
unpushed_vs_remote() {
    local remote="$1" branch="$2"
    git rev-list --count "${remote}/${branch}..HEAD" 2>/dev/null || printf 'unknown\n'
}

# The gate. Returns 0 to proceed, non-zero to refuse, and prints WHY on refusal.
#
# It never switches, stashes, resets, or pulls — refusing is the whole contract. The operator, who
# is the only party that knows whether those 89 commits matter, then acts.
assert_update_safe() {
    local remote="$1" branch="$2" ahead

    if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
        echo "REFUSED: cannot determine the current branch (detached HEAD?). Check out a branch and re-run." >&2
        return 1
    fi

    if remote_is_upstream "$remote" && [ -z "${AIM_UPDATE_REMOTE:-}" ]; then
        echo "REFUSED: '${remote}' is the upstream (${AI_MAESTRO_REPO:-unknown}), which this checkout does not publish to." >&2
        echo "         Pulling it would merge a foreign history into '${branch}'." >&2
        echo "         Add a 'fork' remote, or name one deliberately: AIM_UPDATE_REMOTE=<name> $0" >&2
        return 1
    fi

    if ! git rev-parse --verify --quiet "${remote}/${branch}" >/dev/null 2>&1; then
        echo "REFUSED: '${remote}/${branch}' does not exist — nothing to update from." >&2
        echo "         Fetch it first, or push '${branch}' to '${remote}'." >&2
        return 1
    fi

    ahead="$(unpushed_vs_remote "$remote" "$branch")"
    if [ "$ahead" = "unknown" ]; then
        echo "REFUSED: could not count commits between '${remote}/${branch}' and HEAD." >&2
        return 1
    fi
    if [ "$ahead" != "0" ]; then
        echo "REFUSED: ${ahead} commit(s) on '${branch}' are not on '${remote}/${branch}'." >&2
        echo "         A pull here would bury work that exists only on this disk." >&2
        echo "         Push them, or move them to a branch you keep, then re-run." >&2
        return 1
    fi

    return 0
}
