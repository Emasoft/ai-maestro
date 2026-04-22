#!/bin/bash
set -e

# AI Maestro - Startup script with SSH configuration
# This script ensures SSH agent works in tmux sessions before starting the server

echo "[AI Maestro] Starting up..."

# Step 1: Update SSH agent symlink if needed
if [ -z "${SSH_AUTH_SOCK:-}" ]; then
    echo "[AI Maestro] ⚠ SSH_AUTH_SOCK not set — skipping SSH agent symlink"
elif [ -S "$SSH_AUTH_SOCK" ] && [ ! -h "$SSH_AUTH_SOCK" ]; then
    echo "[AI Maestro] Creating SSH agent symlink..."
    mkdir -p ~/.ssh
    ln -sf "$SSH_AUTH_SOCK" ~/.ssh/ssh_auth_sock
    echo "[AI Maestro] ✓ SSH symlink created: ~/.ssh/ssh_auth_sock"
else
    echo "[AI Maestro] ✓ SSH symlink already exists"
fi

# Step 2: Update tmux global environment (if tmux server is running)
if tmux info &>/dev/null; then
    echo "[AI Maestro] Updating tmux SSH environment..."
    tmux setenv -g SSH_AUTH_SOCK ~/.ssh/ssh_auth_sock
    echo "[AI Maestro] ✓ Tmux SSH_AUTH_SOCK updated"
else
    echo "[AI Maestro] ℹ Tmux server not running (will use correct config when started)"
fi

# Step 3: Warn about stale .next/ build directories (PROP #4).
# When `yarn build` is interrupted or a scenario script moves an active
# `.next/` aside (e.g. to isolate a failing build artifact) the renamed
# `.next.stale-<ts>/` and `.next.stale2-<ts>/` directories silently pile
# up. Each is 80-800 MB — a busy week can easily leave 3-5 GB behind.
# This block lists them with their combined size so the user sees the
# cost on every pm2 restart. It does NOT auto-delete: per the IRON
# "never delete uncommitted files without permission" rule (CLAUDE.md
# RULE 0), the user must run the rm themselves. The canonical cleanup
# command is printed so it is one copy-paste away.
#
# shopt -s nullglob ensures `stale_dirs=( .next.stale* )` expands to an
# empty array when no matches exist, instead of the literal glob string.
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -d "$PROJECT_ROOT" ]; then
    shopt -s nullglob
    # shellcheck disable=SC2164
    cd "$PROJECT_ROOT"
    # `.next.stale*` covers both `.next.stale-<ts>` and `.next.stale2-<ts>`
    # because the latter also starts with `.next.stale`. A second pattern
    # would double-count those dirs in the array.
    stale_dirs=( .next.stale* )
    stale_count=${#stale_dirs[@]}
    if [ "$stale_count" -gt 0 ]; then
        stale_total_kb=0
        for d in "${stale_dirs[@]}"; do
            size_kb=$(du -sk "$d" 2>/dev/null | awk '{print $1}')
            stale_total_kb=$((stale_total_kb + ${size_kb:-0}))
        done
        stale_total_mb=$((stale_total_kb / 1024))
        echo "[AI Maestro] ⚠ Detected ${stale_count} stale .next/ build directories using ~${stale_total_mb} MB total."
        printf '[AI Maestro]   Stale dirs:'
        for d in "${stale_dirs[@]}"; do printf ' %s' "$d"; done
        printf '\n'
        echo "[AI Maestro]   Cleanup (safe — current .next/ is untouched):"
        echo "[AI Maestro]     cd ${PROJECT_ROOT}  &&  rm -rf .next.stale*"
    fi
    shopt -u nullglob
fi

# Step 4: Start the actual server
# NT-032: Verify tsx is available before exec to provide a clear error message
# instead of a cryptic "command not found" after SSH setup completes.
if ! command -v tsx &>/dev/null; then
    echo "[AI Maestro] Error: tsx not found. Install with: npm install -g tsx"
    exit 1
fi
echo "[AI Maestro] Starting server..."
exec tsx server.mjs
