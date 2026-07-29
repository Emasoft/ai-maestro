#!/usr/bin/env bash
set -euo pipefail

# The peer is REQUIRED, not defaulted. This shipped with a specific tailnet host as the
# default, so a no-arg run silently probed a node belonging to whoever wrote it. `${1:?}`
# fails loudly with the usage line instead — there is no sensible default for "someone
# else's machine". (Local edit to a third-party script; upstream had the default.)
HOST=${1:?usage: tailscale-diag.sh <peer-hostname>   — resolve by hostname, never a hardcoded IP}

echo "== tailscale status =="
tailscale status

echo "== tailscale netcheck =="
tailscale netcheck || true

echo "== tailscale ping $HOST =="
tailscale ping "$HOST"
