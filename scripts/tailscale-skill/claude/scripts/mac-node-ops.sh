#!/usr/bin/env bash
set -euo pipefail

DEFAULT_NODE_ID="faea6e83a7e54cf758b8de36dfaf0db8284f7959718c2dbe86c8b2bf2d39ad6b"
NODE_ID="${MAC_NODE_ID:-$DEFAULT_NODE_ID}"
ACTION="${1:-status}"
if [[ $# -gt 0 ]]; then shift; fi

usage() {
  cat <<'EOF'
Usage:
  mac-node-ops.sh [--node <id>] <action> [-- <raw command>]

Actions:
  status              Show OpenClaw node status
  tailscale-status    Show Tailscale state on the Mac
  ollama-status       Show Ollama process, env, models, and local/Tailscale reachability
  ollama-restart      Restart Ollama app and print bind/env checks
  ollama-bind-check   Print Ollama bind env and curl localhost/Tailscale API
  ollama-env          Print LaunchAgent env and launchctl OLLAMA_HOST
  launchagents        List LaunchAgents for the current user
  power               Show sleep / power assertions and settings
  notify -- <text>    Send a local macOS notification to the node
  run -- <cmd>        Run an arbitrary raw shell command on the node (guarded by user intent)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node)
      NODE_ID="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [[ -z "$NODE_ID" ]]; then
  NODE_ID="$(openclaw nodes status 2>/dev/null | awk '/MacBook| macOS |\| Mat/{print prev} {prev=$2}' | head -n1)"
fi

if [[ -z "$NODE_ID" ]]; then
  echo "Could not auto-detect a Mac node. Use --node <id>." >&2
  exit 1
fi

run_node() {
  local cmd="$1"
  openclaw nodes run --node "$NODE_ID" --raw "$cmd"
}

case "$ACTION" in
  status)
    openclaw nodes status
    ;;
  tailscale-status)
    run_node 'tailscale status 2>/dev/null || tailscale ip -4 2>/dev/null || echo "tailscale unavailable"'
    ;;
  ollama-status)
    run_node 'set -e; echo "== launchctl env =="; launchctl getenv OLLAMA_HOST || true; echo; echo "== processes =="; pgrep -fl Ollama || true; pgrep -fl ollama || true; echo; echo "== models =="; curl -fsS http://127.0.0.1:11434/api/tags || true; echo; echo "== tailscale ip =="; TSIP=$(tailscale ip -4 2>/dev/null | head -n1 || true); echo "$TSIP"; if [ -n "$TSIP" ]; then echo; echo "== curl tailscale =="; curl -fsS "http://$TSIP:11434/api/tags" || true; fi'
    ;;
  ollama-restart)
    run_node 'killall Ollama || true; open -a Ollama; sleep 3; echo "OLLAMA_HOST=$(launchctl getenv OLLAMA_HOST || true)"; pgrep -fl Ollama || true; curl -fsS http://127.0.0.1:11434/api/tags || true'
    ;;
  ollama-bind-check)
    run_node 'echo "OLLAMA_HOST=$(launchctl getenv OLLAMA_HOST || true)"; echo; echo "localhost:"; curl -fsS http://127.0.0.1:11434/api/tags || true; echo; TSIP=$(tailscale ip -4 2>/dev/null | head -n1 || true); echo "tailscale-ip=$TSIP"; if [ -n "$TSIP" ]; then curl -fsS "http://$TSIP:11434/api/tags" || true; fi'
    ;;
  ollama-env)
    run_node 'echo "launchctl env:"; launchctl getenv OLLAMA_HOST || true; echo; echo "LaunchAgents:"; ls -la ~/Library/LaunchAgents 2>/dev/null || true; echo; if [ -f ~/Library/LaunchAgents/com.mat.ollama-env.plist ]; then echo "== com.mat.ollama-env.plist =="; cat ~/Library/LaunchAgents/com.mat.ollama-env.plist; fi'
    ;;
  launchagents)
    run_node 'ls -la ~/Library/LaunchAgents 2>/dev/null || echo "No LaunchAgents dir"'
    ;;
  power)
    run_node 'echo "== pmset -g =="; pmset -g || true; echo; echo "== assertions =="; pmset -g assertions || true; echo; echo "== caffeinate =="; pgrep -fl caffeinate || true'
    ;;
  notify)
    if [[ "${1:-}" != "--" ]]; then
      echo "notify requires: notify -- <text>" >&2
      exit 1
    fi
    shift
    openclaw nodes notify --node "$NODE_ID" --title "OpenClaw" --body "$*"
    ;;
  run)
    if [[ "${1:-}" != "--" ]]; then
      echo "run requires: run -- <raw shell command>" >&2
      exit 1
    fi
    shift
    if [[ $# -eq 0 ]]; then
      echo "No raw command provided" >&2
      exit 1
    fi
    run_node "$*"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    usage
    exit 1
    ;;
esac
