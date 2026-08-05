#!/usr/bin/env bash
# =============================================================================
# AI Maestro hibernation probe — is an agent asleep, or broken?
# (TRDD-14HI8ZPR; USER directive 2026-08-05; closes the auth-free probe
# janitor#100 owes.)
# =============================================================================
#
# Like scripts/aimaestro-settings.sh — and unlike every OTHER aimaestro-*.sh
# wrapper here — this one does NOT talk to the HTTP API. Two reasons, both
# load-bearing:
#
#   1. The janitor's daemon holds no $AID_AUTH, and aimaestro-agent.sh list
#      answers HTTP 401 without one (verified live 2026-07-17). A probe the
#      janitor cannot call is not a probe.
#   2. aimaestro-agent.sh runs `check_api_running || exit 1` BEFORE its dispatch
#      table, so every subcommand there requires a live server. This question
#      is most often asked about a host whose agents are all asleep.
#
# It calls lib/agent-hibernation.ts in-process — the SAME module the server's
# fleet-liveness watchdog classifies with — so the CLI and the running server
# cannot disagree about what "hibernated" means (Plugin Abstraction Principle,
# CLAUDE.md).
#
# Usage:
#   aimaestro-hibernation.sh [--json|--tsv] [--agent <id-or-name>]
#
# States: running | hibernated | crashed | never_woken.
#   hibernated  is a HEALTHY state and must never be reported as a fault.
#   crashed     means the clean hibernate path never ran (hibernateAgent
#               unpersists, so a surviving persistence record proves it).
#
# EXIT CODES — grep's trichotomy; `1` is deliberately never used:
#   0 = the query was answered   ·   2 = COULD NOT RUN
# Never write `aimaestro-hibernation.sh || echo ok`: that collapses "I could not
# look" into "I looked and it was fine", the exact failure this repo's
# check-decoupling script exists to prevent.
#
# WHY BASH, NOT SH/ZSH: it sources scripts/pin-node.sh, which is bash-only
# (BASH_SOURCE, `local -a`). Sourced from zsh its version gate degrades SILENTLY
# and can hand back a Node past this repo's <26 engines cap — measured
# 2026-07-30 on scripts/pillar-cli.
# =============================================================================

set -euo pipefail

# ── 1. Find the ai-maestro install that owns the implementation.
# NEVER hardcode ~/ai-maestro: when ai-maestro ships as a package there is no
# such directory. Only ~/.aimaestro and ~/agents live at fixed home paths.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/aimaestro/install-root"
ROOT=""

if [ -f "$SELF_DIR/aimaestro-hibernation-cli.mjs" ]; then
    ROOT="$(cd "$SELF_DIR/.." && pwd)"
elif [ -r "$ROOT_FILE" ]; then
    read -r ROOT < "$ROOT_FILE" || true
    if [ -z "$ROOT" ] || [ ! -f "$ROOT/scripts/aimaestro-hibernation-cli.mjs" ]; then
        echo "aimaestro-hibernation.sh: the recorded ai-maestro install is stale or incomplete." >&2
        echo "aimaestro-hibernation.sh:   recorded: ${ROOT:-<empty>} (from $ROOT_FILE)" >&2
        echo "aimaestro-hibernation.sh:   expected: \$ROOT/scripts/aimaestro-hibernation-cli.mjs" >&2
        echo "aimaestro-hibernation.sh: re-run install-messaging.sh from the ai-maestro checkout." >&2
        exit 2
    fi
else
    echo "aimaestro-hibernation.sh: no ai-maestro install recorded at $ROOT_FILE." >&2
    echo "aimaestro-hibernation.sh: run install-messaging.sh from an ai-maestro checkout first." >&2
    exit 2
fi

# ── 2. Node 22. Reuse the repo's selector; never re-derive it.
# shellcheck source=/dev/null
if ! source "$ROOT/scripts/pin-node.sh"; then
    echo "aimaestro-hibernation.sh: no Node matching ai-maestro's engines range is installed (see above)." >&2
    exit 2
fi

# ── 3. Reach the @/lib/... aliased imports from a FOREIGN cwd.
# Both halves are required (measured on scripts/pillar-cli, 2026-07-30):
#   · `--import tsx` resolves the bare specifier against the CWD, so from a
#     caller's own project it dies with "Cannot find package 'tsx'". An ABSOLUTE
#     path is immune.
#   · tsx discovers tsconfig.json from the CWD too, so without TSX_TSCONFIG_PATH
#     the `@/lib/...` imports inside lib/agent-registry.ts go unresolved. Unlike
#     the settings CLI, this one is NOT cheap insurance — the registry's import
#     chain is aliased today, so omitting it breaks every foreign-cwd call.
TSX_ENTRY="$ROOT/node_modules/tsx/dist/loader.mjs"
if [ ! -f "$TSX_ENTRY" ]; then
    TSX_ENTRY="$(cd "$ROOT" && node -e 'console.log(require.resolve("tsx"))' 2>/dev/null || true)"
fi
if [ -z "$TSX_ENTRY" ] || [ ! -f "$TSX_ENTRY" ]; then
    echo "aimaestro-hibernation.sh: cannot locate tsx in $ROOT/node_modules — run 'yarn install' there." >&2
    exit 2
fi
export TSX_TSCONFIG_PATH="$ROOT/tsconfig.json"

exec node --import "file://$TSX_ENTRY" "$ROOT/scripts/aimaestro-hibernation-cli.mjs" "$@"
