#!/usr/bin/env bash
set -u

section() { printf '\n== %s ==\n' "$1"; }
check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '%-12s %s\n' "$1" "$(command -v "$1")"
  else
    printf '%-12s missing\n' "$1"
  fi
}
unit_state() {
  local unit=$1
  printf '%-24s enabled=%-10s active=%s\n' \
    "$unit" \
    "$(systemctl is-enabled "$unit" 2>/dev/null || true)" \
    "$(systemctl is-active "$unit" 2>/dev/null || true)"
}

section Host
printf 'hostname: %s\n' "$(hostname)"
printf 'kernel:   %s\n' "$(uname -sr)"
printf 'uptime:   %s\n' "$(uptime -p 2>/dev/null || true)"

section Resources
free -h 2>/dev/null | awk '/^Mem:/{print "memory:   total=" $2 " available=" $7}'
df -h / 2>/dev/null | awk 'NR==2{print "root disk: total=" $2 " free=" $4}'

section Tools
for command_name in tailscale git gh tmux docker node pnpm; do
  check_command "$command_name"
done

section Services
unit_state tailscaled
unit_state NetworkManager
unit_state docker

section Sleep
for unit in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
  printf '%-24s %s\n' "$unit" "$(systemctl is-enabled "$unit" 2>/dev/null || true)"
done

section Tailscale
if command -v tailscale >/dev/null 2>&1; then
  tailscale status --self 2>/dev/null || tailscale status 2>/dev/null | head -5 || true
fi

section NetworkManager
if command -v nmcli >/dev/null 2>&1; then
  nmcli -t -f NAME,TYPE,AUTOCONNECT,DEVICE connection show --active 2>/dev/null || true
fi

section Access
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 && echo 'docker daemon: accessible' || echo 'docker daemon: unavailable or permission denied'
fi
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && echo 'GitHub CLI: authenticated' || echo 'GitHub CLI: not authenticated'
fi

printf '\nRead-only check complete. Inspect Wi-Fi secret flags separately; never print PSKs or tokens.\n'
