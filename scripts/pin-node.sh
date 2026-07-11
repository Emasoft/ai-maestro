#!/bin/bash
# pin-node.sh — the ONE place that decides which Node this repo runs on.
# SOURCE it (do not execute it):  source scripts/pin-node.sh || exit 1
#
# WHY THIS EXISTS (TRDD-Y85MSD5U):
#   package.json declares engines.node ">=22.0.0 <26.0.0" and that cap is REAL,
#   not cosmetic: node-pty's compiled binary is NODE_MODULE_VERSION 127 (Node 22
#   ABI) while Node 26 needs 147, and better-sqlite3@12.8.0 hard-caps at Node 25.
#   PTY/terminal streaming is the dashboard's core feature, so an unsupported
#   Node does not degrade the app — it kills it.
#
#   Yarn 1 enforces `engines` at `yarn run` time, BEFORE any script executes. So
#   on a machine whose default node is 26, `yarn build` and `yarn test` abort
#   outright and the repo cannot be built or tested at all. The server launcher
#   used to carry its own private copy of this pin logic; nothing else had any,
#   which is what paralyzed every other entry point. Hence: one implementation,
#   sourced by every entry point that needs a correct Node.
#
# CONTRACT: on success, PATH is prepended with a Node that satisfies `engines`,
#   and $AIM_NODE holds its version string. On failure it returns non-zero and
#   explains how to fix it — it NEVER silently falls back to an unsupported Node
#   (that used to hand you an ERR_DLOPEN_FAILED crash-loop instead of one clear
#   error).

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    echo "pin-node.sh must be sourced, not executed: source scripts/pin-node.sh" >&2
    exit 64
fi

# Report a candidate's REAL major version.
#
# We interrogate the binary instead of trusting its path. This is not paranoia:
# on this machine the homebrew kegs node@23, node@24, node@25 and node@26 all
# report v26.x — a name-only pin would happily "select node@25" and hand you
# Node 26, re-introducing the exact ABI crash this file exists to prevent.
_aim_node_major() {
    "$1" -v 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p'
}

_aim_pin_node() {
    local root min_major max_major want_major nvmrc cand dir major
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    # engines in package.json is the CONTRACT — parse it rather than restating
    # the range here, so this script can never drift from the manifest.
    if ! read -r min_major max_major < <(python3 - "$root/package.json" <<'PY'
import json, re, sys
engines = json.load(open(sys.argv[1])).get("engines", {}).get("node", "")
lo = re.search(r'>=\s*(\d+)', engines)
hi = re.search(r'<\s*(\d+)', engines)
print(lo.group(1) if lo else 0, hi.group(1) if hi else 999)
PY
    ); then
        echo "[pin-node] Could not read engines.node from $root/package.json" >&2
        return 1
    fi

    # .nvmrc is the preferred major inside that range (a hint, not the contract).
    if [ -f "$root/.nvmrc" ]; then
        read -r nvmrc < "$root/.nvmrc" || true
        want_major="${nvmrc#v}"
        want_major="${want_major%%.*}"
    fi

    # Candidates, best first. The already-active node comes first so a correctly
    # configured shell (nvm/mise honouring .nvmrc) is left untouched.
    # NOTE: every append below is written so it cannot abort a caller running
    # `set -e` (with-node.sh and start-with-ssh.sh both do). A bare
    # `[ … ] && cands+=(…)` as the last statement of a loop returns non-zero on
    # the final falsy iteration and would kill the script.
    local -a cands=()
    if [ -n "${want_major:-}" ]; then
        cands+=("/opt/homebrew/opt/node@${want_major}/bin/node")
    fi
    cands+=("$(command -v node 2>/dev/null || true)")
    local m
    for m in $(seq "$((max_major - 1))" -1 "$min_major"); do
        cands+=("/opt/homebrew/opt/node@${m}/bin/node")
    done
    if [ -d "$HOME/.nvm/versions/node" ]; then
        for dir in "$HOME/.nvm/versions/node"/*/bin/node; do
            if [ -x "$dir" ]; then
                cands+=("$dir")
            fi
        done
    fi

    for cand in "${cands[@]}"; do
        [ -n "$cand" ] && [ -x "$cand" ] || continue
        major="$(_aim_node_major "$cand")"
        [ -n "$major" ] || continue
        if [ "$major" -ge "$min_major" ] && [ "$major" -lt "$max_major" ]; then
            # Split the assignment from `export` so a failing dirname surfaces
            # instead of being masked by export's own exit status (SC2155).
            dir="$(dirname "$cand")"
            export PATH="$dir:$PATH"
            AIM_NODE="$("$cand" -v)"
            export AIM_NODE
            return 0
        fi
    done

    echo "[pin-node] FATAL: no Node satisfying engines '>=${min_major} <${max_major}' was found." >&2
    echo "[pin-node]   Active node: $(node -v 2>/dev/null || echo 'none')" >&2
    echo "[pin-node]   ai-maestro's native deps (node-pty, better-sqlite3) do NOT work on Node ${max_major}+." >&2
    echo "[pin-node]   Install a supported Node, e.g.:  brew install node@${want_major:-$min_major}" >&2
    return 1
}

_aim_pin_node
