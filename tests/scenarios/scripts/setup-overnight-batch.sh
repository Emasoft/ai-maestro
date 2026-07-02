#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Master overnight batch SETUP — runs ONCE before all 22 scenarios
#
# Per the user's instruction (2026-04-13): the 22 scenarios should
# be joined into one long sequential batch with a single setup at
# the start and a single cleanup at the end. This script handles
# the heavy work that would otherwise be duplicated 22 times in
# each scenario's Phase 0 SAFE-SETUP.
#
# What this script does (idempotent):
#   1. Captures current git state (commit hash for the report)
#   2. STATE-WIPE master backup of all relevant config files into a
#      single timestamped folder (used by ALL 22 scenarios)
#   3. Builds the project (yarn build) and restarts pm2 if needed
#   4. Verifies server health on http://localhost:23000
#   5. Ensures _aim-placeholder tmux session exists
#   6. Kills ALL stale scen[0-9]* tmux sessions from previous runs
#   7. Calls per-scenario fixture setup scripts that exist (currently
#      only setup-SCEN-018.sh which provisions GitHub fixtures)
#   8. Writes a state file the master cleanup will read
#
# What this script does NOT do:
#   - Login to the dashboard (each scenario subagent does this in
#     its first remaining step, since session cookies don't survive
#     across forked-context subagent boundaries)
#   - Delete any existing user agents (Rule 2: 0-IMPACT applies to
#     existing user resources)
#   - Touch any in-flight teams or governance state — STATE-WIPE
#     restoration in the master cleanup handles drift, not deletion
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPTS_DIR/../../.." && pwd)"
STATE_DIR="$PROJECT_ROOT/tests/scenarios/state"
BACKUP_ROOT="$PROJECT_ROOT/tests/scenarios/state-backups"

# Source the shared helpers for tmux/agent cleanup
source "$SCRIPTS_DIR/fixture-helpers.sh"

mkdir -p "$STATE_DIR"

log "════════════════════════════════════════════════════════════"
log "OVERNIGHT BATCH MASTER SETUP — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "════════════════════════════════════════════════════════════"

# ─── 1. Capture git state ───────────────────────────────────
cd "$PROJECT_ROOT"
GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
log "git: branch=$GIT_BRANCH commit=$GIT_COMMIT dirty=$GIT_DIRTY"

# ─── 2. Master STATE-WIPE backup ────────────────────────────
TS="$(date -u +%Y%m%dT%H%M%SZ)"
MASTER_BACKUP_DIR="$BACKUP_ROOT/OVERNIGHT_${TS}"
mkdir -p "$MASTER_BACKUP_DIR"

log "creating master state backup at $MASTER_BACKUP_DIR"

# ~/.claude/ files
for f in settings.json settings.local.json; do
    if [ -f "$HOME/.claude/$f" ]; then
        cp "$HOME/.claude/$f" "$MASTER_BACKUP_DIR/claude-$f" 2>/dev/null || true
    fi
done

# ~/.aimaestro/ entire snapshot
if [ -d "$HOME/.aimaestro" ]; then
    cp -r "$HOME/.aimaestro" "$MASTER_BACKUP_DIR/aimaestro-snapshot" 2>/dev/null || true
fi

# Project-level .claude/ settings
if [ -f "$PROJECT_ROOT/.claude/settings.local.json" ]; then
    cp "$PROJECT_ROOT/.claude/settings.local.json" "$MASTER_BACKUP_DIR/project-settings.local.json" 2>/dev/null || true
fi

# Write the master snapshot pointer (read by master cleanup)
echo "$MASTER_BACKUP_DIR" > "$STATE_DIR/OVERNIGHT.snapshot"
log "wrote snapshot pointer $STATE_DIR/OVERNIGHT.snapshot"

# Write metadata for the report
cat > "$MASTER_BACKUP_DIR/meta.json" <<META
{
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_commit": "$GIT_COMMIT",
  "git_branch": "$GIT_BRANCH",
  "git_dirty_files": $GIT_DIRTY,
  "backup_dir": "$MASTER_BACKUP_DIR"
}
META

# ─── 3. Build + restart server ──────────────────────────────
log "checking server health..."
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:23000/api/v1/health 2>/dev/null | grep -q "200"; then
    log "server unhealthy — running yarn build + pm2 restart"
    if command -v yarn >/dev/null 2>&1; then
        cd "$PROJECT_ROOT"
        yarn build 2>&1 | tail -10 || die "yarn build failed"
    fi
    pm2 restart ai-maestro 2>&1 | tail -3 || die "pm2 restart failed"
    # Wait for server to come back up
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost:23000/api/v1/health 2>/dev/null | grep -q "200"; then
            log "server back up after ${i}s"
            break
        fi
        sleep 1
    done
fi

# Final health check
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:23000/api/v1/health 2>/dev/null || echo "000")
if [ "$HEALTH" != "200" ]; then
    die "server still unhealthy: HTTP $HEALTH"
fi
log "server health: OK (HTTP 200)"

# ─── 4. Tmux setup ──────────────────────────────────────────
need tmux

# Ensure _aim-placeholder exists (the runner expects it)
if ! tmux has-session -t _aim-placeholder 2>/dev/null; then
    log "creating _aim-placeholder tmux session"
    tmux new-session -d -s _aim-placeholder
fi

# Kill all stale scen* tmux sessions from previous runs (every prefix)
log "killing stale scen* tmux sessions"
fixture_kill_tmux_by_prefix "scen001-"
fixture_kill_tmux_by_prefix "scen002-"
fixture_kill_tmux_by_prefix "scen003-"
fixture_kill_tmux_by_prefix "scen004-"
fixture_kill_tmux_by_prefix "scen005-"
fixture_kill_tmux_by_prefix "scen006-"
fixture_kill_tmux_by_prefix "scen007-"
fixture_kill_tmux_by_prefix "scen008-"
fixture_kill_tmux_by_prefix "scen009-"
fixture_kill_tmux_by_prefix "scen010-"
fixture_kill_tmux_by_prefix "scen011-"
fixture_kill_tmux_by_prefix "scen012-"
fixture_kill_tmux_by_prefix "scen013-"
fixture_kill_tmux_by_prefix "scen014-"
fixture_kill_tmux_by_prefix "scen015-"
fixture_kill_tmux_by_prefix "scen016-"
fixture_kill_tmux_by_prefix "scen017-"
fixture_kill_tmux_by_prefix "scen018-"
fixture_kill_tmux_by_prefix "scen019-"
fixture_kill_tmux_by_prefix "scen020-"
fixture_kill_tmux_by_prefix "scen021-"
fixture_kill_tmux_by_prefix "scen022-"
# Also kill any cos-scen* mirror sessions
fixture_kill_tmux_by_prefix "cos-scen"

# ─── 5. Delete any orphan scen* agents from prior runs ──────
log "deleting orphan scen* agents from registry"
for prefix in scen001 scen002 scen003 scen004 scen005 scen006 scen007 scen008 \
              scen009 scen010 scen011 scen012 scen013 scen014 scen015 scen016 \
              scen017 scen018 scen019 scen020 scen021 scen022; do
    fixture_delete_agents_by_prefix "${prefix}-" 2>/dev/null || true
done

# ─── 6. Call per-scenario fixture setup scripts that exist ──
log "running per-scenario fixture setup scripts"
for n in 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022; do
    setup_script="$SCRIPTS_DIR/setup-SCEN-${n}.sh"
    if [ -x "$setup_script" ]; then
        log "  → calling $(basename "$setup_script")"
        if bash "$setup_script" 2>&1 | tail -5; then
            log "    OK"
        else
            log "    WARN: setup-SCEN-${n}.sh exited non-zero (continuing)"
        fi
    fi
done

# ─── 7. Disk space check ────────────────────────────────────
FREE_GB=$(df -BG /Users/emanuelesabetta/ai-maestro 2>/dev/null | tail -1 | awk '{gsub(/G/,"",$4); print $4}')
log "disk free: ${FREE_GB}GB"
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 5 ]; then
    die "less than 5GB free — aborting overnight run"
fi

# ─── 8. Done ────────────────────────────────────────────────
log "════════════════════════════════════════════════════════════"
log "MASTER SETUP COMPLETE — backup=$MASTER_BACKUP_DIR"
log "════════════════════════════════════════════════════════════"
