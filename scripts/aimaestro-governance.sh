#!/usr/bin/env bash
# =============================================================================
# AI Maestro Governance CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro governance API. Plugins
# (MANAGER, CHIEF-OF-STAFF, …) call THIS script, never the HTTP API directly:
# the skill-facing CLI here is immutable, while the server API behind it may
# change freely. New capability = new subcommand or new optional flag only.
#
# Auth: an agent caller exports AID_AUTH (Bearer token); the local system
# owner needs none (localhost is trusted). A sudo token, when the caller has
# one, is passed through AIMAESTRO_SUDO_TOKEN as the X-Sudo-Token header.
# Governance passwords are passed per-command via --password (the body field
# the route expects), never via a header.
#
# Usage:
#   aimaestro-governance.sh whoami
#   aimaestro-governance.sh requests [--status S] [--type T] [--host H] [--agent A]
#   aimaestro-governance.sh request --type T --password P --target-host H \
#       --requested-by RB --role R (--agent A | --payload-json '{...}')
#   aimaestro-governance.sh approve <id> --password P [--approver UUID]
#   aimaestro-governance.sh reject  <id> --password P [--rejector UUID] [--reason R]
#
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source the shared foundation (get_api_base, get_auth_args, check_jq).
if [ -f "${SCRIPT_DIR}/shell-helpers/common.sh" ]; then
    source "${SCRIPT_DIR}/shell-helpers/common.sh"
elif [ -f "${HOME}/.local/share/aimaestro/shell-helpers/common.sh" ]; then
    source "${HOME}/.local/share/aimaestro/shell-helpers/common.sh"
else
    echo "Error: cannot locate shell-helpers/common.sh" >&2
    exit 1
fi

check_jq || exit 1

# ---------------------------------------------------------------------------
# _api METHOD PATH [json_body]
# One authenticated request with HTTP-status-aware error handling. Prints the
# response body on 2xx; on >=400 prints "Error: HTTP <code> — <.error>" to
# stderr and returns 1. Auth + sudo headers are injected from the environment.
# ---------------------------------------------------------------------------
_api() {
    local method="$1" path="$2" body="${3:-}"
    local base
    base="$(get_api_base)"
    local -a auth_args=()
    get_auth_args auth_args
    local -a sudo_args=()
    if [ -n "${AIMAESTRO_SUDO_TOKEN:-}" ]; then
        sudo_args=(-H "X-Sudo-Token: ${AIMAESTRO_SUDO_TOKEN}")
    fi

    local resp code out
    if [ -n "$body" ]; then
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${sudo_args[@]}" \
            -H "Content-Type: application/json" -d "$body" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    else
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${sudo_args[@]}" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    fi

    code="$(printf '%s' "$resp" | tail -n1)"
    out="$(printf '%s' "$resp" | sed '$d')"

    if [ "$code" -ge 400 ] 2>/dev/null; then
        local err
        err="$(printf '%s' "$out" | jq -r '.error // .message // empty' 2>/dev/null)"
        echo "Error: HTTP ${code}${err:+ — ${err}}" >&2
        return 1
    fi
    printf '%s\n' "$out"
}

show_help() {
    cat <<'EOF'
aimaestro-governance.sh — AI Maestro governance CLI

Commands:
  whoami                       Show governance config (manager, owner title, hasManager)
  requests [filters]           List governance requests
      --status S   filter by status (pending|approved|rejected)
      --type T     filter by request type
      --host H     filter by host id
      --agent A    filter by agent id
  request <flags>              Create a governance request
      --type T              request type (required)
      --password P          governance password (required)
      --target-host H       target host id (required)
      --requested-by RB     requesting agent id/name (required)
      --role R              requester governance role (required)
      --agent A             subject agent id (builds payload {agentId:A})
      --payload-json '{…}'  full payload object (overrides --agent)
  approve <id> --password P [--approver UUID]
  reject  <id> --password P [--rejector UUID] [--reason R]
  help                         Show this help

Environment:
  AID_AUTH               Bearer token for agent callers (optional on localhost)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough for strict routes (optional)
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

cmd_whoami() {
    _api GET "/api/governance"
}

cmd_requests() {
    local qs=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --status) qs="${qs}&status=$2"; shift 2 ;;
            --type)   qs="${qs}&type=$2";   shift 2 ;;
            --host)   qs="${qs}&hostId=$2"; shift 2 ;;
            --agent)  qs="${qs}&agentId=$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'requests': $1" >&2; return 1 ;;
        esac
    done
    # Trim the leading '&' into a leading '?'.
    local path="/api/v1/governance/requests"
    [ -n "$qs" ] && path="${path}?${qs#&}"
    _api GET "$path"
}

cmd_request() {
    local type="" password="" target_host="" requested_by="" role="" agent="" payload_json=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --type)         type="$2";         shift 2 ;;
            --password)     password="$2";     shift 2 ;;
            --target-host)  target_host="$2";  shift 2 ;;
            --requested-by) requested_by="$2"; shift 2 ;;
            --role)         role="$2";         shift 2 ;;
            --agent)        agent="$2";        shift 2 ;;
            --payload-json) payload_json="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'request': $1" >&2; return 1 ;;
        esac
    done
    if [ -z "$type" ] || [ -z "$password" ] || [ -z "$target_host" ] || \
       [ -z "$requested_by" ] || [ -z "$role" ]; then
        echo "Error: --type, --password, --target-host, --requested-by and --role are required" >&2
        return 1
    fi
    local payload
    if [ -n "$payload_json" ]; then
        payload="$(printf '%s' "$payload_json" | jq -c '.' 2>/dev/null)" || {
            echo "Error: --payload-json is not valid JSON" >&2; return 1; }
    elif [ -n "$agent" ]; then
        payload="$(jq -nc --arg a "$agent" '{agentId: $a}')"
    else
        echo "Error: provide --agent or --payload-json" >&2; return 1
    fi
    local body
    body="$(jq -nc \
        --arg type "$type" --arg password "$password" --arg host "$target_host" \
        --arg rb "$requested_by" --arg role "$role" --argjson payload "$payload" \
        '{type:$type, password:$password, targetHostId:$host, requestedBy:$rb, requestedByRole:$role, payload:$payload}')"
    _api POST "/api/v1/governance/requests" "$body"
}

cmd_approve() {
    local id="${1:-}"; shift || true
    [ -z "$id" ] && { echo "Error: request id required" >&2; return 1; }
    local password="" approver=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --password) password="$2"; shift 2 ;;
            --approver) approver="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'approve': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$password" ] && { echo "Error: --password required" >&2; return 1; }
    local body
    if [ -n "$approver" ]; then
        body="$(jq -nc --arg p "$password" --arg a "$approver" '{password:$p, approverAgentId:$a}')"
    else
        body="$(jq -nc --arg p "$password" '{password:$p}')"
    fi
    _api POST "/api/v1/governance/requests/${id}/approve" "$body"
}

cmd_reject() {
    local id="${1:-}"; shift || true
    [ -z "$id" ] && { echo "Error: request id required" >&2; return 1; }
    local password="" rejector="" reason=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --password) password="$2"; shift 2 ;;
            --rejector) rejector="$2"; shift 2 ;;
            --reason)   reason="$2";   shift 2 ;;
            *) echo "Error: unknown flag for 'reject': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$password" ] && { echo "Error: --password required" >&2; return 1; }
    local body
    body="$(jq -nc --arg p "$password" --arg r "$rejector" --arg reason "$reason" \
        '{password:$p} + (if $r != "" then {rejectorAgentId:$r} else {} end) + (if $reason != "" then {reason:$reason} else {} end)')"
    _api POST "/api/v1/governance/requests/${id}/reject" "$body"
}

case "${1:-help}" in
    whoami|config) shift; cmd_whoami "$@" ;;
    requests)      shift; cmd_requests "$@" ;;
    request)       shift; cmd_request "$@" ;;
    approve)       shift; cmd_approve "$@" ;;
    reject)        shift; cmd_reject "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v)  echo "aimaestro-governance.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
