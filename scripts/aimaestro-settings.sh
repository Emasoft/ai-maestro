#!/usr/bin/env bash
# =============================================================================
# AI Maestro Settings CLI — the universal gated settings.json /
# settings.local.json editor (TRDD-RYFP030K).
# =============================================================================
#
# Unlike every other aimaestro-*.sh wrapper in this directory, this one does
# NOT talk to the HTTP API. It invokes scripts/aimaestro-settings-cli.mjs
# directly, in-process, because the installer runs with the ai-maestro server
# DOWN — an HTTP-only tool would be useless at the exact moment it is most
# needed. Both this CLI and app/api/settings/edit/route.ts call the SAME
# shared function, lib/settings-gate.ts's editSettings/readSettings, which
# itself delegates to lib/json-io.ts's updateJson — the ONE lock + write path
# for every settings mutation in this codebase (TRDD-RYFP030K).
#
# Usage:
#   aimaestro-settings.sh get <path>
#   aimaestro-settings.sh set <path> --key <dot.path> --value <json-or-string> [--no-create]
#   aimaestro-settings.sh set <path> --key-json '["a","b"]' --value <json-or-string> [--no-create]
#   aimaestro-settings.sh delete <path> --key <dot.path> [--no-create]
#   aimaestro-settings.sh delete <path> --key-json '["a","b"]' [--no-create]
#   aimaestro-settings.sh edit <path> --ops '<json array of {"op":"set"|"delete","keyPath":[...],"value"?:...}>' [--no-create]
#
# <path> must be an absolute settings.json or settings.local.json path, living
# directly inside a ".claude" directory — see lib/settings-gate.ts. --key is
# dot-path sugar; a key containing a literal dot needs --key-json instead.
#
# ⚠ AND THAT FAILS SILENTLY, WHICH IS WHY IT IS SPELLED OUT RATHER THAN LEFT TO
# THE LINE ABOVE. Passing such a key to --key does not error — it SPLITS, exit 0,
# and the file still parses, so the damage surfaces much later as a hook or
# permission that never fires:
#
#   --key 'hooks.Bash(x.y:*)'        →  hooks → "Bash(x" → "y:*)"     WRONG, silent
#   --key-json '["hooks","Bash(x.y:*)"]'                              correct
#
# This is the COMMON case, not an edge case: Claude Code matchers and permission
# entries routinely contain dots — Bash(node script.js:*), mcp__srv__tool. Use
# --key-json for any key that might contain one.
#
# (Reported by the CORE plugin's Claude, 2026-08-02, ai-maestro-plugin#31. Their
# note on HOW they found it is worth as much as the finding: their first probe
# used `permissions.Bash(ls:*)` and "passed" — that key has no dot INSIDE it, so
# it proved nothing. When a property has a boundary, the fixture must cross it on
# purpose, never by luck.)
#
# WHY BASH, NOT SH/ZSH: it sources scripts/pin-node.sh, which is bash-only
# (BASH_SOURCE, `local -a`). Sourced from zsh its version gate degrades
# SILENTLY and can hand back a Node past this repo's <26 engines cap (measured
# 2026-07-30 on scripts/pillar-cli, the sibling script this one's ROOT/tsx
# resolution below is deliberately modelled on).
# =============================================================================

set -euo pipefail

# ── 1. Find the ai-maestro install that owns the implementation.
#
# NEVER hardcode ~/ai-maestro: when ai-maestro ships as a package there is no
# such directory (CLAUDE.md, install-location independence). Only
# ~/.aimaestro and ~/agents stay at fixed home paths.
#
# Two ways, in order, and the first is a TEST rather than a guess: if this
# script is sitting in an ai-maestro tree that carries the implementation
# (running straight from the repo — development, or this task's own
# verification), use that tree. Otherwise fall back to the install root
# install-messaging.sh records at ~/.local/share/aimaestro/install-root. This
# script keeps its OWN basename when copied to ~/.local/bin (unlike
# scripts/pillar-cli, which is copied under a NEW name per pillar tool), so
# the sibling check below correctly fails once installed and always falls
# through to the recorded root.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/aimaestro/install-root"
ROOT=""

if [ -f "$SELF_DIR/aimaestro-settings-cli.mjs" ]; then
    ROOT="$(cd "$SELF_DIR/.." && pwd)"
elif [ -r "$ROOT_FILE" ]; then
    read -r ROOT < "$ROOT_FILE" || true
    if [ -z "$ROOT" ] || [ ! -f "$ROOT/scripts/aimaestro-settings-cli.mjs" ]; then
        echo "aimaestro-settings.sh: the recorded ai-maestro install is stale or incomplete." >&2
        echo "aimaestro-settings.sh:   recorded: ${ROOT:-<empty>} (from $ROOT_FILE)" >&2
        echo "aimaestro-settings.sh:   expected: \$ROOT/scripts/aimaestro-settings-cli.mjs" >&2
        echo "aimaestro-settings.sh: re-run install-messaging.sh from the ai-maestro checkout." >&2
        exit 2
    fi
else
    echo "aimaestro-settings.sh: no ai-maestro install recorded at $ROOT_FILE." >&2
    echo "aimaestro-settings.sh: run install-messaging.sh from an ai-maestro checkout first." >&2
    exit 2
fi

# ── 2. Node 22. Reuse the repo's selector; never re-derive it.
# shellcheck source=/dev/null
if ! source "$ROOT/scripts/pin-node.sh"; then
    echo "aimaestro-settings.sh: no Node matching ai-maestro's engines range is installed (see above)." >&2
    exit 2
fi

# ── 3. Reach lib/settings-gate.ts + lib/json-io.ts from a FOREIGN cwd.
#
# Both halves are required (measured on scripts/pillar-cli, 2026-07-30):
#   · `--import tsx` resolves the bare specifier against the CWD, so from a
#     caller's own project it dies with "Cannot find package 'tsx'". An
#     ABSOLUTE path is immune.
#   · tsx discovers tsconfig.json from the CWD too, so without
#     TSX_TSCONFIG_PATH an `@/lib/...`-aliased import would go unresolved.
#     Today's imports in aimaestro-settings-cli.mjs / lib/settings-gate.ts /
#     lib/json-io.ts are all relative, so this is cheap insurance rather than
#     a hard requirement — set it anyway so a future aliased import in any of
#     them does not silently break only when invoked from a foreign cwd.
TSX_ENTRY="$ROOT/node_modules/tsx/dist/loader.mjs"
if [ ! -f "$TSX_ENTRY" ]; then
    # tsx's "." export has moved before; ask node rather than hardcoding a
    # second guess.
    TSX_ENTRY="$(cd "$ROOT" && node -e 'console.log(require.resolve("tsx"))' 2>/dev/null || true)"
fi
if [ -z "$TSX_ENTRY" ] || [ ! -f "$TSX_ENTRY" ]; then
    echo "aimaestro-settings.sh: cannot locate tsx in $ROOT/node_modules — run 'yarn install' there." >&2
    exit 2
fi
export TSX_TSCONFIG_PATH="$ROOT/tsconfig.json"

exec node --import "file://$TSX_ENTRY" "$ROOT/scripts/aimaestro-settings-cli.mjs" "$@"
