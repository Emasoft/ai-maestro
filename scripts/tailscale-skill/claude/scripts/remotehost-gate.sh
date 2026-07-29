#!/usr/bin/env bash
set -u

explicit=0
requested_share=0

usage() {
  cat <<'USAGE'
Usage: remotehost-gate.sh [--explicit] [--requested-share]

Exit 0 only when remotehost is allowed:
  --explicit          The user explicitly asked to spin up remotehost/Tailscale/remote access.
  --requested-share   The user asked for a shareable website/API/dev-server link.

Without --explicit, this script also requires a high-confidence remote-session
signal such as SSH, Codespaces, Gitpod, Coder, or a cloud workstation.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --explicit)
      explicit=1
      ;;
    --requested-share)
      requested_share=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "remotehost allowed: no"
      echo "reason: unknown argument: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

strong=()
weak=()

add_if_set() {
  var_name="$1"
  label="$2"
  eval "value=\${$var_name:-}"
  if [ -n "$value" ]; then
    strong+=("$label")
  fi
}

if [ -n "${SSH_CONNECTION:-}" ] || [ -n "${SSH_CLIENT:-}" ] || [ -n "${SSH_TTY:-}" ]; then
  strong+=("SSH session")
fi

if [ "${CODESPACES:-}" = "true" ]; then
  strong+=("GitHub Codespaces")
fi

add_if_set "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN" "GitHub Codespaces port forwarding"
add_if_set "GITPOD_WORKSPACE_ID" "Gitpod workspace"
add_if_set "CODER_WORKSPACE_NAME" "Coder workspace"
add_if_set "CDE_WORKSPACE_ID" "CDE workspace"
add_if_set "IDX_WORKSPACE_ID" "Project IDX workspace"
add_if_set "GOOGLE_CLOUD_WORKSTATIONS" "Google Cloud Workstations"
add_if_set "CLOUD_SHELL" "cloud shell"

if [ -f "/.dockerenv" ]; then
  weak+=("container marker")
fi

if [ -r "/proc/1/cgroup" ] && grep -qaE "docker|kubepods|containerd|podman" "/proc/1/cgroup"; then
  weak+=("container cgroup")
fi

if [ "$explicit" -eq 1 ]; then
  echo "remotehost allowed: yes"
  echo "reason: user explicitly requested remotehost or remote access"
  exit 0
fi

if [ "$requested_share" -ne 1 ]; then
  echo "remotehost allowed: no"
  echo "reason: no explicit request and no share-link/API/dev-server request was declared"
  exit 10
fi

if [ "${#strong[@]}" -gt 0 ]; then
  echo "remotehost allowed: yes"
  echo "reason: requested share plus high-confidence remote-session signal"
  printf "signals:\n"
  for signal in "${strong[@]}"; do
    printf "  - %s\n" "$signal"
  done
  exit 0
fi

echo "remotehost allowed: no"
echo "reason: requested share, but no high-confidence remote-session signal was detected"
if [ "${#weak[@]}" -gt 0 ]; then
  printf "weak signals ignored:\n"
  for signal in "${weak[@]}"; do
    printf "  - %s\n" "$signal"
  done
fi
echo "next: ask the user before spinning up remotehost"
exit 10
