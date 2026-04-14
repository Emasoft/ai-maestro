#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Fixture helpers — shared functions for setup-SCEN-NNN.sh and
# cleanup-SCEN-NNN.sh. Source this file from any fixture script:
#
#   source "$HARNESS_DIR/scripts/fixture-helpers.sh"
#
# Each helper is idempotent. Setup helpers can be called twice
# without double-creation. Cleanup helpers silently skip missing
# resources.
#
# IMPORTANT: none of these functions touch ~/.claude/ or the
# dashboard UI. They only manipulate fixtures (github, filesystem,
# tmux state, fake repos). The scenario runner agent still drives
# the browser for UI validation per Rule 6.
# ──────────────────────────────────────────────────────────────

set -eu

# Resolve repo root from any caller
PROJECT_ROOT="/Users/emanuelesabetta/ai-maestro"
SCRIPTS_DIR="$PROJECT_ROOT/tests/scenarios/scripts"
STATE_DIR="$PROJECT_ROOT/tests/scenarios/state"
FIXTURES_TMP_ROOT="/tmp/aim-scen-fixtures-$$"

mkdir -p "$STATE_DIR"

log() { printf '[fixture] %s\n' "$*"; }
die() { printf '[fixture] ERROR: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

# ── GitHub repo provisioner ──────────────────────────────────
# Usage: fixture_github_repo <owner/repo> [template]
#
# Creates an empty public GitHub repo (safe to ignore, marked as
# a test fixture in the description) and populates it from one of:
#   - with-buggy-python   — divide() with sign-flip bug + failing test + publish.py
#   - with-buggy-ts       — TypeScript equivalent
#   - empty               — just README + LICENSE
#
# Idempotent: if the repo already exists, refreshes the fixture
# content but does not delete/recreate.
fixture_github_repo() {
    local repo_full="${1:?fixture_github_repo: missing owner/repo}"
    local template="${2:-empty}"
    need gh

    local owner="${repo_full%/*}"
    local repo="${repo_full#*/}"

    gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated"

    if gh repo view "$repo_full" --json name >/dev/null 2>&1; then
        log "repo $repo_full already exists — refreshing fixtures"
    else
        log "creating $repo_full..."
        gh repo create "$repo_full" --public --description "Scenario test fixture — safe to ignore" --add-readme >/dev/null
    fi

    local work_dir="$FIXTURES_TMP_ROOT/$repo"
    mkdir -p "$(dirname "$work_dir")"
    if [ -d "$work_dir" ]; then
        rm -rf "$work_dir"
    fi
    git clone --quiet "https://github.com/$repo_full.git" "$work_dir"
    (
        cd "$work_dir"
        git config user.name "Emasoft"
        git config user.email "713559+Emasoft@users.noreply.github.com"

        case "$template" in
            with-buggy-python) _fixture_apply_buggy_python ;;
            with-buggy-ts)     _fixture_apply_buggy_ts ;;
            empty)             log "template=empty — only README + LICENSE" ;;
            *)                 die "unknown template: $template" ;;
        esac

        git add -A  # This is a CHILD PROCESS inside an isolated /tmp clone
                    # of a fixture repo. `git add -A` here is safe because
                    # the working tree is empty except for fixtures we just
                    # wrote. NEVER use this pattern in the main ai-maestro
                    # repo — see CLAUDE.md rules.
        if git diff --cached --quiet; then
            log "no fixture changes for $repo_full"
        else
            git commit -q -m "chore: refresh scenario fixtures"
            git push -q origin HEAD
            log "pushed fixtures to $repo_full"
        fi
    )
}

# Delete a fixture GitHub repo. Requires explicit confirmation via
# OVERNIGHT_HARNESS_ALLOW_DELETE=1 env var — the harness sets this
# for cleanup passes. Without it, the function refuses.
fixture_github_repo_delete() {
    local repo_full="${1:?fixture_github_repo_delete: missing owner/repo}"
    if [ "${OVERNIGHT_HARNESS_ALLOW_DELETE:-}" != "1" ]; then
        log "refusing to delete $repo_full without OVERNIGHT_HARNESS_ALLOW_DELETE=1"
        return 0
    fi
    if ! gh repo view "$repo_full" --json name >/dev/null 2>&1; then
        log "repo $repo_full already absent"
        return 0
    fi
    log "deleting $repo_full..."
    gh repo delete "$repo_full" --yes
}

_fixture_apply_buggy_python() {
    mkdir -p src tests scripts .githooks
    cat > src/buggy.py <<'PY'
"""Buggy math helpers used by scenario fixtures."""

def divide(a: int, b: int) -> int:
    if b == 0:
        raise ZeroDivisionError("division by zero")
    if a < 0:
        return -(a // b)  # ← double-negate bug
    return a // b
PY
    touch src/__init__.py
    cat > tests/test_buggy.py <<'PY'
"""Failing test that exercises the divide() sign-flip bug."""
from src.buggy import divide

def test_divide_positive() -> None:
    assert divide(10, 2) == 5

def test_divide_negative_should_be_negative() -> None:
    assert divide(-10, 2) == -5

def test_divide_zero_denominator() -> None:
    import pytest
    with pytest.raises(ZeroDivisionError):
        divide(1, 0)
PY
    touch tests/__init__.py
    cat > pyproject.toml <<'TOML'
[project]
name = "scenario-fixture"
version = "0.1.0"
description = "Scenario test fixture — safe to ignore"
requires-python = ">=3.12"
dependencies = ["pytest>=8"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
TOML
    # Minimal strict publish.py — real implementation lives in the
    # sibling file tests/scenarios/fixtures/setup-scen018-repos.sh
    # which runs once to create the initial fixtures. Scripts here
    # refresh content only.
    [ -f scripts/publish.py ] || cat > scripts/publish.py <<'PY'
#!/usr/bin/env python3
"""Minimal scenario fixture publish.py."""
import sys
print("[fixture-publish] stub — do not run directly", file=sys.stderr)
sys.exit(1)
PY
    chmod +x scripts/publish.py
}

_fixture_apply_buggy_ts() {
    mkdir -p src tests
    cat > src/buggy.ts <<'TS'
export function divide(a: number, b: number): number {
    if (b === 0) throw new Error("division by zero")
    if (a < 0) return -(Math.floor(a / b))  // ← double-negate bug
    return Math.floor(a / b)
}
TS
    cat > tests/buggy.test.ts <<'TS'
import { divide } from '../src/buggy'
import { describe, it, expect } from 'vitest'

describe('divide', () => {
    it('divides positive numbers', () => { expect(divide(10, 2)).toBe(5) })
    it('divides negative numbers', () => { expect(divide(-10, 2)).toBe(-5) })
    it('throws on zero denominator', () => { expect(() => divide(1, 0)).toThrow() })
})
TS
}

# ── Tmux orphan cleanup ──────────────────────────────────────
# Usage: fixture_kill_tmux_by_prefix <prefix>
#   Kills all tmux sessions whose name starts with <prefix>.
#   Preserves session `_aim-placeholder` which keeps the tmux
#   server alive for the harness.
fixture_kill_tmux_by_prefix() {
    local prefix="${1:?fixture_kill_tmux_by_prefix: missing prefix}"
    tmux list-sessions 2>/dev/null | cut -d: -f1 | while read -r session; do
        if [ "$session" = "_aim-placeholder" ]; then
            continue
        fi
        case "$session" in
            "${prefix}"*)
                log "killing tmux session: $session"
                tmux kill-session -t "$session" 2>&1 || true
                ;;
        esac
    done
}

# ── Agent registry orphan cleanup (DO NOT USE — architecture violation) ──
# This function is RETAINED as a tombstone to document the architectural
# rule it violated. It previously called the agent-delete API directly,
# bypassing the sudo-mode authentication gate. That is exactly the rogue-
# script-bypassing-auth vector SEC-PHASE-1c was designed to prevent.
# Rule 6 STICK-TO-UI applies to cleanup scripts as much as to scenarios:
# the proper way to delete test agents is to drive the dashboard UI via
# a browser automation MCP (CDT or dev-browser), using the same sudo
# modal + confirm flow that real users follow.
#
# The v2 plugin rewrite (TRDD-f79f6047) mandates UI-driven cleanup.
# Until then, orphan scen* agents must be cleaned manually via the UI
# or via a dedicated UI-cleanup subagent spawned by the orchestrator.
fixture_delete_agents_by_prefix() {
    local prefix="${1:?fixture_delete_agents_by_prefix: missing prefix}"
    log "NOOP: fixture_delete_agents_by_prefix is architecturally deprecated (Rule 6 STICK-TO-UI violation). Prefix '$prefix' agents must be cleaned via UI."
    return 0
}

# ── Ai Maestro state snapshot ────────────────────────────────
# Usage: fixture_snapshot_aim_state <output-dir>
#   Copies ~/.aimaestro/ and ~/.claude/settings.json to the given
#   directory for Rule 3 STATE-WIPE backup purposes.
fixture_snapshot_aim_state() {
    local out_dir="${1:?fixture_snapshot_aim_state: missing output dir}"
    mkdir -p "$out_dir"
    if [ -d "$HOME/.aimaestro" ]; then
        cp -r "$HOME/.aimaestro" "$out_dir/aimaestro-snapshot" 2>/dev/null || true
    fi
    if [ -f "$HOME/.claude/settings.json" ]; then
        cp "$HOME/.claude/settings.json" "$out_dir/settings.json.bak" 2>/dev/null || true
    fi
    log "snapshot saved to $out_dir"
}
