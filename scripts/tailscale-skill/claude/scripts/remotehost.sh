#!/usr/bin/env bash
set -u

socket_path="/private/tmp/remotehost-tailscaled.sock"
state_path="/private/tmp/remotehost-tailscaled.state"
state_dir="/private/tmp/remotehost-tailscaled"
log_path="/private/tmp/remotehost-tailscaled.log"
pid_path="/private/tmp/remotehost-tailscaled.pid"

ttl="1h"
app_path=""
fresh=0
no_expire=0
public=0
forced_socket=0
mode="system"
target=""
port=""
tailscale_bin=""
tailscaled_bin=""
socket_arg=()

usage() {
  cat <<'USAGE'
Usage:
  remotehost.sh share [options] localhost:PORT
  remotehost.sh status [options] [PORT]
  remotehost.sh off [options]

Options:
  --socket PATH       Userspace tailscaled socket.

Options for share:
  --app-path PATH     Print final URLs with PATH or ?query appended.
  --ttl DURATION     Auto-close after DURATION. Default: 1h.
  --no-expire        Do not schedule cleanup.
  --fresh            Rotate userspace Tailscale state before sharing.
  --public           Use Tailscale Funnel instead of private Serve.

Private share configures HTTPS MagicDNS plus an HTTP tailnet-IP fallback.
Use --public only after the user explicitly approves internet exposure.
USAGE
}

die() {
  echo "remotehost: $*" >&2
  exit 1
}

duration_seconds() {
  raw="$1"
  number="$raw"
  unit="s"
  case "$raw" in
    *[smhd]) unit="${raw: -1}"; number="${raw%?}" ;;
  esac
  case "$number" in ''|*[!0-9]*) return 1 ;; esac
  case "$unit" in
    s) echo "$number" ;;
    m) echo "$(( number * 60 ))" ;;
    h) echo "$(( number * 3600 ))" ;;
    d) echo "$(( number * 86400 ))" ;;
    *) return 1 ;;
  esac
}

find_bin() {
  name="$1"
  fallback="$2"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
  elif [ -x "$fallback" ]; then
    echo "$fallback"
  else
    return 1
  fi
}

load_tailscale() {
  tailscale_bin="$(find_bin tailscale /usr/local/opt/tailscale/bin/tailscale)" || return 1
}

load_tailscaled() {
  tailscaled_bin="$(find_bin tailscaled /usr/local/opt/tailscale/bin/tailscaled)" || return 1
}

join_url() {
  base="$1"
  suffix="$2"
  case "$suffix" in
    "") echo "$base" ;;
    http://*|https://*) echo "$suffix" ;;
    \?*) echo "${base%/}/${suffix}" ;;
    /*) echo "${base%/}${suffix}" ;;
    *) echo "${base%/}/${suffix}" ;;
  esac
}

normalize_target() {
  raw="$1"
  case "$raw" in
    http://*|https://*|https+insecure://*|tcp://*) echo "$raw" ;;
    *:*) echo "$raw" ;;
    *[!0-9]*) echo "$raw" ;;
    *) echo "localhost:$raw" ;;
  esac
}

ts() {
  "$tailscale_bin" "${socket_arg[@]}" "$@"
}

socket_live() {
  [ -S "$socket_path" ] || return 1
  "$tailscale_bin" "--socket=$socket_path" status >/dev/null 2>&1
}

choose_mode() {
  if [ "$forced_socket" -eq 1 ]; then
    mode="userspace"
    socket_arg=("--socket=$socket_path")
    return
  fi

  status_probe="$("$tailscale_bin" status 2>&1)"
  status_code="$?"
  if [ "$status_code" -eq 0 ]; then
    mode="system"
    socket_arg=()
    return
  fi

  case "$status_probe" in
    *"Logged out."*|*"NeedsLogin"*|*"stopped; run"*)
      mode="system"
      socket_arg=()
      return
      ;;
  esac

  mode="userspace"
  socket_arg=("--socket=$socket_path")
}

prepare_tailscale() {
  load_tailscale || die "tailscale command not found"
  choose_mode
}

stop_userspace() {
  if [ -f "$pid_path" ]; then
    old_pid="$(cat "$pid_path" 2>/dev/null || true)"
    case "$old_pid" in
      ''|*[!0-9]*) ;;
      *) kill "$old_pid" >/dev/null 2>&1 || true ;;
    esac
    rm -f "$pid_path"
  fi

  # Clean up daemons launched by older versions of this skill.
  if command -v launchctl >/dev/null 2>&1; then
    launchctl remove remotehost.tailscaled >/dev/null 2>&1 || true
  fi

  rm -f "$socket_path"
}

archive_state() {
  stamp="$(date +%Y%m%d%H%M%S)"
  if [ -f "$state_path" ]; then
    mv "$state_path" "${state_path}.stale-${stamp}"
  fi
  if [ -d "$state_dir" ]; then
    mv "$state_dir" "${state_dir}.stale-${stamp}"
  fi
}

start_userspace() {
  load_tailscaled || die "tailscaled command not found"
  mkdir -p "$(dirname "$socket_path")" "$(dirname "$state_path")" "$(dirname "$log_path")" "$state_dir"
  stop_userspace

  nohup "$tailscaled_bin" \
    --tun=userspace-networking \
    --socket="$socket_path" \
    --state="$state_path" \
    --statedir="$state_dir" \
    >"$log_path" 2>&1 &
  echo "$!" >"$pid_path"

  remaining=80
  while [ "$remaining" -gt 0 ]; do
    if socket_live; then
      return 0
    fi
    sleep 0.25
    remaining="$(( remaining - 1 ))"
  done

  echo "remotehost: tailscaled did not become reachable on $socket_path" >&2
  [ -f "$log_path" ] && tail -40 "$log_path" >&2
  exit 1
}

ensure_tailscale() {
  if [ "$mode" = "userspace" ]; then
    if [ "$fresh" -eq 1 ]; then
      stop_userspace
      archive_state
    fi
    if ! socket_live; then
      start_userspace
    fi
  fi

  status_output="$(ts status 2>&1 || true)"
  case "$status_output" in
    *"Logged out."*|*"NeedsLogin"*|*"stopped; run"*|*"NoState"*)
      ts up
      status_output="$(ts status 2>&1 || true)"
      ;;
  esac

  if [ "$mode" = "userspace" ]; then
    first_line="$(printf "%s\n" "$status_output" | sed -n '1p')"
    if printf "%s" "$first_line" | grep -q " offline"; then
      echo "remotehost: userspace Tailscale node is stale/offline; rotating state"
      stop_userspace
      archive_state
      start_userspace
      ts up
    fi
  fi
}

tailscale_ip() {
  ts ip -4 2>/dev/null | sed -n '1p'
}

tailscale_host() {
  ts status --json 2>/dev/null \
    | sed -n 's/.*"DNSName": "\([^"]*\)".*/\1/p' \
    | sed -n '1s/\.$//p'
}

print_local_check() {
  [ -n "$port" ] || return 0
  echo
  echo "localhost check: http://127.0.0.1:${port}/"
  if command -v curl >/dev/null 2>&1; then
    curl -sS -I --max-time 5 "http://127.0.0.1:${port}/" 2>&1 | sed 's/^/  /' || true
  else
    echo "  curl: not found"
  fi
}

print_status() {
  echo "remotehost diagnostics"
  echo "cwd: $(pwd)"
  echo "os: $(uname -s 2>/dev/null || echo unknown) $(uname -m 2>/dev/null || echo unknown)"
  echo

  if ! load_tailscale; then
    echo "tailscale: not found"
    echo "next: install Tailscale, then run this skill again"
    print_local_check
    return 0
  fi

  choose_mode
  echo "tailscale: $tailscale_bin"
  echo "remotehost mode: $mode"
  if [ "$mode" = "userspace" ]; then
    echo "remotehost socket: $socket_path"
    echo "remotehost state: $state_path"
    if ! socket_live; then
      echo "remotehost userspace daemon: not running"
      print_local_check
      return 0
    fi
  fi

  echo
  echo "tailscale version:"
  ts version 2>&1 | sed 's/^/  /' || true
  echo
  echo "tailscale status:"
  ts status 2>&1 | sed 's/^/  /' || true
  echo
  echo "tailscale ip -4:"
  ts ip -4 2>&1 | sed 's/^/  /' || true
  echo
  echo "tailscale serve status:"
  ts serve status 2>&1 | sed 's/^/  /' || true
  print_local_check
}

schedule_cleanup() {
  [ "$no_expire" -eq 0 ] || return 0
  seconds="$(duration_seconds "$ttl")" || die "invalid --ttl value: $ttl"
  [ "$seconds" -gt 0 ] || return 0

  log="/tmp/remotehost-cleanup.log"
  socket_flag=""
  if [ "${#socket_arg[@]}" -gt 0 ]; then
    socket_flag="${socket_arg[0]}"
  fi

  nohup sh -c "sleep '$seconds'; '$tailscale_bin' $socket_flag serve --https=443 off >/dev/null 2>&1 || true; '$tailscale_bin' $socket_flag serve --http=80 off >/dev/null 2>&1 || true; '$tailscale_bin' $socket_flag funnel reset >/dev/null 2>&1 || true; if [ -f '$pid_path' ]; then kill \"\$(cat '$pid_path')\" >/dev/null 2>&1 || true; rm -f '$pid_path'; fi" >"$log" 2>&1 &
  echo "remotehost expiry: ${ttl} (${seconds}s)"
  echo "remotehost cleanup pid: $!"
  echo "remotehost cleanup log: $log"
}

share_private() {
  ts serve --bg --https=443 "$target" || exit 1
  ts serve --bg --http=80 "$target" >/dev/null 2>&1 || true
  ts serve status || true

  host="$(tailscale_host)"
  ip="$(tailscale_ip)"
  if [ -n "$host" ]; then
    echo "remotehost app url: $(join_url "https://${host}/" "$app_path")"
    echo "remotehost http url: $(join_url "http://${host}/" "$app_path")"
  fi
  if [ -n "$ip" ]; then
    echo "remotehost ip url: $(join_url "http://${ip}/" "$app_path")"
  fi
  schedule_cleanup
}

share_public() {
  ts funnel --bg --yes "$target" || exit 1
  ts funnel status || true
  host="$(tailscale_host)"
  if [ -n "$host" ]; then
    echo "remotehost public url: $(join_url "https://${host}/" "$app_path")"
  fi
  schedule_cleanup
}

disable_remotehost() {
  prepare_tailscale
  if [ "$mode" = "userspace" ] && ! socket_live; then
    stop_userspace
    echo "remotehost: userspace daemon stopped"
    return 0
  fi
  ts serve --https=443 off >/dev/null 2>&1 || true
  ts serve --http=80 off >/dev/null 2>&1 || true
  ts funnel reset >/dev/null 2>&1 || true
  [ "$mode" = "userspace" ] && stop_userspace
  echo "remotehost: Serve/Funnel disabled"
}

parse_socket_value() {
  [ "$#" -gt 1 ] || die "missing value for --socket"
  socket_path="$2"
  forced_socket=1
}

subcommand="${1:-}"
case "$subcommand" in
  -h|--help|"")
    usage
    exit 0
    ;;
esac
shift

case "$subcommand" in
  share)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --app-path) [ "$#" -gt 1 ] || die "missing value for --app-path"; app_path="$2"; shift 2 ;;
        --app-path=*) app_path="${1#--app-path=}"; shift ;;
        --ttl) [ "$#" -gt 1 ] || die "missing value for --ttl"; ttl="$2"; shift 2 ;;
        --ttl=*) ttl="${1#--ttl=}"; shift ;;
        --socket) parse_socket_value "$@"; shift 2 ;;
        --socket=*) socket_path="${1#--socket=}"; forced_socket=1; shift ;;
        --fresh) fresh=1; shift ;;
        --no-expire) no_expire=1; shift ;;
        --public) public=1; shift ;;
        -h|--help) usage; exit 0 ;;
        -*)
          echo "unknown option: $1" >&2
          usage
          exit 2
          ;;
        *)
          [ -z "$target" ] || die "unexpected extra target: $1"
          target="$1"
          shift
          ;;
      esac
    done
    [ -n "$target" ] || die "missing target, for example localhost:3000"
    target="$(normalize_target "$target")"
    prepare_tailscale
    ensure_tailscale
    if [ "$public" -eq 1 ]; then
      share_public
    else
      share_private
    fi
    ;;
  status)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --socket) parse_socket_value "$@"; shift 2 ;;
        --socket=*) socket_path="${1#--socket=}"; forced_socket=1; shift ;;
        -h|--help) usage; exit 0 ;;
        -*)
          echo "unknown option: $1" >&2
          usage
          exit 2
          ;;
        *)
          [ -z "$port" ] || die "unexpected extra argument: $1"
          port="$1"
          shift
          ;;
      esac
    done
    print_status
    ;;
  off)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --socket) parse_socket_value "$@"; shift 2 ;;
        --socket=*) socket_path="${1#--socket=}"; forced_socket=1; shift ;;
        -h|--help) usage; exit 0 ;;
        -*)
          echo "unknown option: $1" >&2
          usage
          exit 2
          ;;
        *)
          die "unexpected argument: $1"
          ;;
      esac
    done
    disable_remotehost
    ;;
  *)
    echo "unknown subcommand: $subcommand" >&2
    usage
    exit 2
    ;;
esac
