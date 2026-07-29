#!/usr/bin/env bash
# tailscale-hosting-helper — Common operations for tailscale serve

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: tailscale-hosting-helper <command> [args]

Commands:
  status              Show current serve configuration
  add <path> <port>   Add a new serve path (e.g., add /dashboard 5123)
  remove <path>       Remove a specific serve path
  reset               Remove ALL serve configuration (DANGER)
  file <path> <file>  Serve a single static file
  dir <path> <dir>    Serve a directory via python http.server
  serve-funnel-help   Show funnel vs serve difference

Examples:
  tailscale-hosting-helper add /sankey 8765
  tailscale-hosting-helper file /report /home/user/report.html
  tailscale-hosting-helper dir /static /home/user/static-files
EOF
}

status() {
    echo "=== Tailscale Serve Status ==="
    tailscale serve status
}

add_path() {
    local path="$1"
    local port="$2"
    echo "Adding serve path: $path -> http://localhost:$port"
    tailscale serve --bg --set-path "$path" "http://localhost:$port"
}

remove_path() {
    local path="$1"
    echo "Removing serve path: $path"
    # Tailscale serve doesn't have a per-path remove; reset is the only way
    echo "WARNING: tailscale serve does not support removing individual paths."
    echo "Options:"
    echo "  1. Use 'tailscale serve reset' to remove ALL paths"
    echo "  2. Re-run serve with the paths you want to keep"
}

reset_all() {
    echo "DANGER: This will remove ALL serve configuration."
    read -p "Are you sure? [y/N] " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        tailscale serve reset
        echo "All serve configuration removed."
    else
        echo "Aborted."
    fi
}

serve_file() {
    local path="$1"
    local file="$2"
    local port=8765

    if [[ ! -f "$file" ]]; then
        echo "Error: File not found: $file"
        exit 1
    fi

    # Create temp dir with just that file
    local tmpdir=$(mktemp -d)
    cp "$file" "$tmpdir/"
    local basename=$(basename "$file")

    # Start python server
    python3 -m http.server "$port" --directory "$tmpdir" &
    local server_pid=$!
    sleep 1

    # Add tailscale serve
    tailscale serve --bg --set-path "$path" "http://127.0.0.1:$port"

    echo "Serving $file at https://<node>.<tailnet>.ts.net$path/$basename"
    echo "Server PID: $server_pid (kill $server_pid to stop)"
}

serve_dir() {
    local path="$1"
    local dir="$2"
    local port=8765

    if [[ ! -d "$dir" ]]; then
        echo "Error: Directory not found: $dir"
        exit 1
    fi

    # Find available port
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
        ((port++))
    done

    python3 -m http.server "$port" --directory "$dir" &
    local server_pid=$!
    sleep 1

    tailscale serve --bg --set-path "$path" "http://127.0.0.1:$port"

    echo "Serving $dir at https://<node>.<tailnet>.ts.net$path"
    echo "Server PID: $server_pid (kill $server_pid to stop)"
}

serve_funnel_help() {
    cat <<'EOF'
=== Tailscale Serve vs Funnel ===

SERVE (Private, Default)
  - Only devices in your tailnet can access
  - URL: https://node.tailnet.ts.net/path
  - Safe for personal dashboards, internal tools
  - Command: tailscale serve --bg --set-path /x http://localhost:3000

FUNNEL (Public Internet)
  - Anyone on the internet can access
  - Same URL, but no Tailscale required
  - Requires admin activation: https://login.tailscale.com/f/funnel
  - Use ONLY when explicitly sharing with non-Tailscale users
  - Command: tailscale funnel --bg --set-path /x http://localhost:3000

RULE: Always use SERVE unless the user explicitly asks for public access.
EOF
}

case "${1:-}" in
    status)
        status
        ;;
    add)
        [[ $# -ne 3 ]] && { usage; exit 1; }
        add_path "$2" "$3"
        ;;
    remove)
        [[ $# -ne 2 ]] && { usage; exit 1; }
        remove_path "$2"
        ;;
    reset)
        reset_all
        ;;
    file)
        [[ $# -ne 3 ]] && { usage; exit 1; }
        serve_file "$2" "$3"
        ;;
    dir)
        [[ $# -ne 3 ]] && { usage; exit 1; }
        serve_dir "$2" "$3"
        ;;
    serve-funnel-help)
        serve_funnel_help
        ;;
    *)
        usage
        exit 1
        ;;
esac
