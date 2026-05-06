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

# Step 4: Mode-coherence guard.
#
# When the server runs in dev mode (`next dev`, NODE_ENV ≠ production)
# but `.next/` already contains a production build (created by an
# earlier `yarn build`), the dev compiler reuses the prod manifests
# but emits dev-style chunk URLs (`/_next/static/chunks/main-app.js`)
# that don't exist on disk — every chunk returns 404 and the
# dashboard is unrenderable. The reverse mismatch (NODE_ENV=production
# but no production build) is also caught here.
#
# We detect this BEFORE exec'ing the server and self-heal by
# archiving the stale `.next/` to `.next.stale-<ts>/` (recoverable).
# The server then boots cleanly and dev re-compiles on first request.
#
# Detection signals:
#   - `.next/BUILD_ID` is written ONLY by `next build`. Its presence
#     means the directory was last populated by a production build.
#   - `next dev` does NOT write BUILD_ID (it writes a `package.json`
#     with `{"type":"commonjs"}` and a `cache/` dir but no BUILD_ID).
NODE_ENV_RESOLVED="${NODE_ENV:-development}"
if [ -d "$PROJECT_ROOT/.next" ] && [ -f "$PROJECT_ROOT/.next/BUILD_ID" ] && [ "$NODE_ENV_RESOLVED" != "production" ]; then
    GUARD_TS=$(date +%Y%m%d_%H%M%S)
    GUARD_ARCHIVE="$PROJECT_ROOT/.next.stale-mode-mismatch-${GUARD_TS}"
    echo "[AI Maestro] ⚠ Mode-coherence mismatch detected:"
    echo "[AI Maestro]   .next/ contains a PRODUCTION build (BUILD_ID present)"
    echo "[AI Maestro]   but NODE_ENV='$NODE_ENV_RESOLVED' (expects DEVELOPMENT)."
    echo "[AI Maestro]   Archiving .next/ → $(basename "$GUARD_ARCHIVE")/ so dev mode can rebuild cleanly."
    mv "$PROJECT_ROOT/.next" "$GUARD_ARCHIVE"
    echo "[AI Maestro] ✓ Archived. Dev mode will re-compile on first request."
    echo "[AI Maestro]   To recover the prod build: mv $(basename "$GUARD_ARCHIVE") .next"
elif [ ! -f "$PROJECT_ROOT/.next/BUILD_ID" ] && [ "$NODE_ENV_RESOLVED" = "production" ]; then
    echo "[AI Maestro] ✗ Mode-coherence mismatch detected:"
    echo "[AI Maestro]   NODE_ENV=production but .next/BUILD_ID is missing."
    echo "[AI Maestro]   Run \`yarn build\` first, then start with NODE_ENV=production."
    exit 1
fi

# Step 5: Start the actual server
# NT-032: Verify tsx is available before exec to provide a clear error message
# instead of a cryptic "command not found" after SSH setup completes.
if ! command -v tsx &>/dev/null; then
    echo "[AI Maestro] Error: tsx not found. Install with: npm install -g tsx"
    exit 1
fi
echo "[AI Maestro] Starting server (NODE_ENV=$NODE_ENV_RESOLVED)..."
exec tsx server.mjs
