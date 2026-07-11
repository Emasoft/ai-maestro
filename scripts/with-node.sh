#!/bin/bash
# with-node.sh — run any command under this repo's supported Node.
#
#   bash scripts/with-node.sh yarn build
#   bash scripts/with-node.sh yarn test
#   bash scripts/with-node.sh node -v
#
# WHY (TRDD-Y85MSD5U): yarn enforces `engines` before any package.json script
# runs, so the Node must already be correct when `yarn` is invoked — it cannot be
# fixed from inside a script. And an ai-maestro agent's tmux shell has no
# nvm/mise hook, so it cannot rely on the ambient shell selecting the right Node.
# This wrapper is the deterministic entry point that works from any shell.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/pin-node.sh
source "$DIR/pin-node.sh" || exit 1

if [ "$#" -eq 0 ]; then
    echo "usage: bash scripts/with-node.sh <command> [args…]" >&2
    echo "       (pinned Node: ${AIM_NODE:-unknown})" >&2
    exit 64
fi

exec "$@"
