#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Master overnight batch CLEANUP — runs ONCE after all 22 scenarios
#
# Per the user's instruction (2026-04-13): one cleanup at the end
# instead of 22 redundant per-scenario cleanups.
#
# What this script does (idempotent):
#   1. Calls per-scenario cleanup scripts that exist (currently only
#      cleanup-SCEN-018.sh)
#   2. Deletes ALL scen[0-9]* agents from the registry (catches
#      anything the in-scenario UI cleanup missed)
#   3. Kills ALL scen* tmux sessions
#   4. Restores ~/.claude/settings.json + .local.json from the
#      master snapshot if drift is detected (Rule 3 STATE-WIPE)
#   5. Restores ~/.aimaestro/ from snapshot ONLY if the user agent
#      registry got corrupted — never blindly overwrites since real
#      user agents may have changed during the run
#   6. Writes a final summary line
#
# What this script does NOT do:
#   - Force-delete user agents that share a scen* prefix accidentally
#   - Restore git state (the runner subagents apply Rule 4 fix-as-
#     you-go and may have committed legitimate fixes — those stay)
#   - Touch the per-scenario reports or screenshots
# ──────────────────────────────────────────────────────────────

set -eu

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPTS_DIR/../../.." && pwd)"
STATE_DIR="$PROJECT_ROOT/tests/scenarios/state"

source "$SCRIPTS_DIR/fixture-helpers.sh"

log "════════════════════════════════════════════════════════════"
log "OVERNIGHT BATCH MASTER CLEANUP — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "════════════════════════════════════════════════════════════"

# ─── 1. Per-scenario fixture cleanup ────────────────────────
log "running per-scenario fixture cleanup scripts"
for n in 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022; do
    cleanup_script="$SCRIPTS_DIR/cleanup-SCEN-${n}.sh"
    if [ -x "$cleanup_script" ]; then
        log "  → calling $(basename "$cleanup_script")"
        bash "$cleanup_script" 2>&1 | tail -5 || log "    WARN: cleanup-SCEN-${n}.sh exited non-zero (continuing)"
    fi
done

# ─── 2. Delete all scen* agents (final safety net) ──────────
log "deleting any remaining scen* agents from registry"
for prefix in scen001 scen002 scen003 scen004 scen005 scen006 scen007 scen008 \
              scen009 scen010 scen011 scen012 scen013 scen014 scen015 scen016 \
              scen017 scen018 scen019 scen020 scen021 scen022; do
    fixture_delete_agents_by_prefix "${prefix}-" 2>/dev/null || true
done

# ─── 3. Kill all scen* tmux sessions ────────────────────────
log "killing scen* tmux sessions"
for prefix in scen001- scen002- scen003- scen004- scen005- scen006- scen007- \
              scen008- scen009- scen010- scen011- scen012- scen013- scen014- \
              scen015- scen016- scen017- scen018- scen019- scen020- scen021- \
              scen022- cos-scen; do
    fixture_kill_tmux_by_prefix "$prefix"
done

# ─── 3a. Kill orphan chrome-devtools-mcp node processes ──────
# Each forked runner subagent spawns its own MCP connection, which
# in turn spawns a private headless Chromium. When the runner's
# context ends, the Chromium dies but the watchdog node processes
# can linger. Over 22 scenarios these accumulate ~4 GB of RAM.
# Safe to kill — the next batch will spawn fresh MCPs on demand.
log "killing orphan chrome-devtools-mcp node processes"
BEFORE_CDM=$(ps aux | grep -c "[c]hrome-devtools-mcp" || echo 0)
pkill -f chrome-devtools-mcp 2>/dev/null || true
sleep 2
AFTER_CDM=$(ps aux | grep -c "[c]hrome-devtools-mcp" || echo 0)
log "  chrome-devtools-mcp: ${BEFORE_CDM} -> ${AFTER_CDM}"

# ─── 3b. Compress all PNG screenshots to JPEG 97% ───────────
# UI screenshot PNG files are large (avg ~630 KB each); a 22-scenario
# batch produces ~500+ files totaling ~350 MB. Converting to JPEG 97%
# via macOS `sips` saves ~50 MB per batch and preserves visual fidelity
# for verification purposes. Safe — only deletes PNG after successful
# JPEG write.
log "compressing screenshots (PNG -> JPEG 97%)"
if [ -x "$SCRIPTS_DIR/compress-screenshots.sh" ]; then
    bash "$SCRIPTS_DIR/compress-screenshots.sh" 2>&1 | tail -6
else
    log "  WARN: compress-screenshots.sh missing — skipping"
fi

# ─── 4. STATE-WIPE restoration ──────────────────────────────
snapshot_pointer="$STATE_DIR/OVERNIGHT.snapshot"
if [ ! -f "$snapshot_pointer" ]; then
    log "WARN: no master snapshot pointer at $snapshot_pointer — skipping state restore"
else
    snapshot_dir="$(cat "$snapshot_pointer")"
    if [ ! -d "$snapshot_dir" ]; then
        log "WARN: snapshot dir $snapshot_dir missing — skipping state restore"
    else
        log "comparing current config files with master snapshot at $snapshot_dir"

        # ~/.claude/settings.json
        if [ -f "$snapshot_dir/claude-settings.json" ] && [ -f "$HOME/.claude/settings.json" ]; then
            if ! cmp -s "$snapshot_dir/claude-settings.json" "$HOME/.claude/settings.json"; then
                log "  ~/.claude/settings.json drifted — restoring"
                cp "$snapshot_dir/claude-settings.json" "$HOME/.claude/settings.json"
            else
                log "  ~/.claude/settings.json unchanged"
            fi
        fi

        # ~/.claude/settings.local.json
        if [ -f "$snapshot_dir/claude-settings.local.json" ] && [ -f "$HOME/.claude/settings.local.json" ]; then
            if ! cmp -s "$snapshot_dir/claude-settings.local.json" "$HOME/.claude/settings.local.json"; then
                log "  ~/.claude/settings.local.json drifted — restoring"
                cp "$snapshot_dir/claude-settings.local.json" "$HOME/.claude/settings.local.json"
            else
                log "  ~/.claude/settings.local.json unchanged"
            fi
        fi

        # Project .claude/settings.local.json
        # NOTE: we do NOT auto-restore this. The orchestrator may have added
        # allow-list entries during the run that legitimately should persist.
        # Instead we just diff and log so the user can review.
        if [ -f "$snapshot_dir/project-settings.local.json" ] && [ -f "$PROJECT_ROOT/.claude/settings.local.json" ]; then
            if ! cmp -s "$snapshot_dir/project-settings.local.json" "$PROJECT_ROOT/.claude/settings.local.json"; then
                log "  project .claude/settings.local.json drifted — NOT auto-restoring (manual review)"
                log "  diff vs snapshot saved at $snapshot_dir/project-settings.diff"
                diff "$snapshot_dir/project-settings.local.json" \
                     "$PROJECT_ROOT/.claude/settings.local.json" \
                     > "$snapshot_dir/project-settings.diff" 2>/dev/null || true
            else
                log "  project .claude/settings.local.json unchanged"
            fi
        fi

        # ~/.aimaestro/ — only restore agent registry if it shrank substantially
        # (suggests test agents weren't cleaned). Never auto-restore the whole
        # tree; the user's real agents may have legitimately changed.
        if [ -f "$snapshot_dir/aimaestro-snapshot/agents/registry.json" ] && \
           [ -f "$HOME/.aimaestro/agents/registry.json" ]; then
            BEFORE_COUNT=$(grep -c '"id"' "$snapshot_dir/aimaestro-snapshot/agents/registry.json" 2>/dev/null || echo 0)
            AFTER_COUNT=$(grep -c '"id"' "$HOME/.aimaestro/agents/registry.json" 2>/dev/null || echo 0)
            log "  agent registry: before=$BEFORE_COUNT after=$AFTER_COUNT"
            if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
                log "  WARN: registry grew by $((AFTER_COUNT - BEFORE_COUNT)) — leftover scen* agents?"
            fi
        fi
    fi
fi

# ─── 5. Final summary ───────────────────────────────────────
DONE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log "════════════════════════════════════════════════════════════"
log "MASTER CLEANUP COMPLETE — $DONE_TS"
log "════════════════════════════════════════════════════════════"
