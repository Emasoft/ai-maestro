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

    # Fail closed: an unparseable/missing HTTP status (e.g. curl wrote no
    # %{http_code} line, or a proxy mangled the response) must be treated as an
    # error, never silently printed as a success body — otherwise the [ -ge 400 ]
    # test would be a no-op and the empty/garbage body would flow downstream as
    # if it were a 2xx response (fail-fast invariant).
    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from ${path} (no HTTP status code)" >&2
        return 1
    fi

    if [ "$code" -ge 400 ]; then
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
  login                        Log in as the human owner; stores a SESSION TOKEN at
                               ~/.aimaestro/cli-session (0600) so every aimaestro-*.sh
                               and amp-*.sh authenticates as you. Prompts on the TTY —
                               the password is never an argument, never an env var, and
                               never stored; only the token is. (ai-maestro#55)
  logout                       Forget the stored session token.
  invalidate-password          Revoke the governance password (you must know it).
                               Prompts on the TTY — never takes it as an argument.
                               Must be run ON the machine hosting AI Maestro: the
                               server confirms with a code delivered to that
                               machine's desktop. The next login asks for a new
                               password. (TRDD-P7XKV3N9)
  whoami                       Show governance config (manager, owner title, hasManager)
  status                       Alias for whoami — flat governance probe (hasManager, …)
  requests [filters]           List governance requests
      --status S   filter by status: pending | remote-approved | local-approved
                   | dual-approved | executed | rejected
      --type T     filter by type: add-to-team | remove-from-team | assign-cos
                   | remove-cos | transfer-agent | create-agent | delete-agent
                   | configure-agent
      --host H     filter by host id
      --agent A    filter by agent id (UUID)
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
  transfer list [--team ID] [--agent ID] [--status S]   List team-transfer requests
  transfer create --agent ID --from-team ID --to-team ID [--note TEXT]
  transfer resolve <transferId> --action approve|reject [--reject-reason TEXT]
  help                         Show this help

Environment:
  AID_AUTH               Bearer token for agent callers (REQUIRED — no localhost exemption)
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

# Team-transfer flow — the DEDICATED /api/governance/transfers surface (distinct
# from a generic `request --type transfer-agent`, which is the cross-host path).
# requestedBy/resolvedBy are taken from the authenticated identity (AID_AUTH) by
# the server, never a flag — so the caller MUST export AID_AUTH.
cmd_transfer() {
    local sub="${1:-}"; shift || true
    case "$sub" in
        list)
            local qs=""
            while [ $# -gt 0 ]; do
                case "$1" in
                    --team)   qs="${qs}&teamId=$2";  shift 2 ;;
                    --agent)  qs="${qs}&agentId=$2"; shift 2 ;;
                    --status) qs="${qs}&status=$2";  shift 2 ;;
                    *) echo "Error: unknown flag for 'transfer list': $1" >&2; return 1 ;;
                esac
            done
            local path="/api/governance/transfers"
            [ -n "$qs" ] && path="${path}?${qs#&}"
            _api GET "$path"
            ;;
        create)
            local agent="" from="" to="" note=""
            while [ $# -gt 0 ]; do
                case "$1" in
                    --agent)     agent="$2"; shift 2 ;;
                    --from-team) from="$2";  shift 2 ;;
                    --to-team)   to="$2";    shift 2 ;;
                    --note)      note="$2";  shift 2 ;;
                    *) echo "Error: unknown flag for 'transfer create': $1" >&2; return 1 ;;
                esac
            done
            if [ -z "$agent" ] || [ -z "$from" ] || [ -z "$to" ]; then
                echo "Error: --agent, --from-team and --to-team are required" >&2; return 1
            fi
            local body
            body="$(jq -nc --arg a "$agent" --arg f "$from" --arg t "$to" --arg n "$note" \
                '{agentId:$a, fromTeamId:$f, toTeamId:$t} + (if $n != "" then {note:$n} else {} end)')"
            _api POST "/api/governance/transfers" "$body"
            ;;
        resolve)
            local id="${1:-}"; shift || true
            [ -z "$id" ] && { echo "Error: transfer id required" >&2; return 1; }
            local action="" reason=""
            while [ $# -gt 0 ]; do
                case "$1" in
                    --action)        action="$2"; shift 2 ;;
                    --reject-reason) reason="$2"; shift 2 ;;
                    *) echo "Error: unknown flag for 'transfer resolve': $1" >&2; return 1 ;;
                esac
            done
            if [ "$action" != "approve" ] && [ "$action" != "reject" ]; then
                echo "Error: --action must be 'approve' or 'reject'" >&2; return 1
            fi
            local body
            body="$(jq -nc --arg act "$action" --arg r "$reason" \
                '{action:$act} + (if $r != "" then {rejectReason:$r} else {} end)')"
            _api POST "/api/governance/transfers/${id}/resolve" "$body"
            ;;
        *) echo "Error: 'transfer' needs a subcommand: list | create | resolve" >&2; return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# invalidate-password — revoke the governance password using the password.
#
# TRDD-P7XKV3N9. This wrapper carries NO POLICY. Every gate (possession, the
# console check, the OS-delivered code, the rate limit) lives in the endpoint and
# nowhere else — because every route is curl-able, so a check placed in a client
# is not a weak check, it is NO check. This script's only jobs are: read the
# secrets from a TTY, and POST them.
#
# The password is read with `read -s` from the terminal. NEVER an argument, never
# an env var on the command line: argv is visible in `ps` to every process on the
# box and lands in shell history (TRDD-E9BZ5P7S — 197 clear-text copies of this
# very password leaked into a public repo exactly because it was passed around as
# a value).
# ---------------------------------------------------------------------------
cmd_invalidate_password() {
    local password code resp

    if [ ! -t 0 ]; then
        echo "Error: invalidate-password needs a terminal — it prompts for the password." >&2
        echo "       It is never accepted as an argument or an env var (it would leak via ps/history)." >&2
        exit 1
    fi

    printf 'Governance password: ' >&2
    read -rs password
    printf '\n' >&2
    [ -n "$password" ] || { echo "Error: empty password" >&2; exit 1; }

    # Step 1 — prove possession; the server puts a code on this machine's desktop.
    # jq --arg does the escaping: a password with a quote or backslash must not be
    # able to break out of the JSON string (or forge extra fields).
    resp="$(_api POST /api/governance/password/invalidate \
        "$(jq -nc --arg p "$password" '{password:$p}')")" || exit 1

    if echo "$resp" | grep -q '"codeRequired"'; then
        echo "A confirmation code was sent to this machine's desktop." >&2
        echo "(If you are not sitting at that machine, you will not see it — that is the point.)" >&2
        printf 'Code: ' >&2
        read -r code
        printf '\n' >&2
    else
        # No code demanded means the server did not reach step 3 — surface whatever
        # it said rather than pretending we succeeded.
        echo "$resp"
        exit 1
    fi

    # Step 2 — prove presence.
    _api POST /api/governance/password/invalidate \
        "$(jq -nc --arg p "$password" --arg c "$code" '{password:$p, code:$c}')"
}


# LOG IN as the human owner and store the SESSION TOKEN (ai-maestro#55).
#
# Every `aimaestro-*.sh` used to send only an agent's AID bearer, so a HUMAN at a
# terminal got 401 from all of them — the script layer was unusable by the person who
# owns the machine. The scripts now also accept the dashboard's `aim_session` cookie;
# this is how a human obtains one without a browser.
#
# THE PASSWORD NEVER BECOMES DATA. It is prompted on the TTY, sent once, and
# discarded — never an argument (it would sit in `ps` and shell history), never an env
# var (it would be inherited by every child process), never written to disk. Only the
# resulting TOKEN is stored, 0600, and a token is revocable and expiring; a password is
# neither.
cmd_login() {
    local password resp token file dir

    if [ ! -t 0 ]; then
        echo "Error: login needs a terminal — it prompts for the governance password." >&2
        echo "       It is never accepted as an argument or an env var (it would leak via ps/history)." >&2
        exit 1
    fi

    printf 'Governance password: ' >&2
    read -rs password
    printf '\n' >&2
    [ -n "$password" ] || { echo "Error: empty password" >&2; exit 1; }

    # -i so we can read Set-Cookie. jq --arg escapes the password into the JSON string:
    # a quote or backslash in it must not be able to break out or forge extra fields.
    local base
    base="$(get_api_base)"
    resp="$(curl -s -i --max-time 30 -X POST \
        -H "Content-Type: application/json" \
        -d "$(jq -nc --arg p "$password" '{password:$p}')" \
        "${base}/api/auth/login")" || { echo "Error: login request failed (network)" >&2; exit 1; }
    unset password

    token="$(printf '%s' "$resp" \
        | tr -d '\r' \
        | sed -n 's/^[Ss]et-[Cc]ookie: *aim_session=\([^;]*\).*/\1/p' \
        | head -n1)"

    if [ -z "$token" ]; then
        echo "Error: login failed — no session issued." >&2
        printf '%s' "$resp" | sed -n 's/.*"error" *: *"\([^"]*\)".*/       \1/p' | head -n1 >&2
        exit 1
    fi

    file="$(cli_session_file)"
    dir="$(dirname "$file")"
    mkdir -p "$dir"
    # Write 0600 BEFORE the content lands: a token briefly world-readable is a token
    # leaked. umask alone is not enough — the file may already exist with looser perms.
    ( umask 077; : > "$file" )
    chmod 600 "$file" 2>/dev/null || true
    printf '%s' "$token" > "$file"

    echo "Logged in. Session stored in ${file} (0600)."
    echo "Every aimaestro-*.sh / amp-*.sh now authenticates as you. Use 'logout' to end it."
}

# Forget the stored session. (The server-side session expires on its own; this removes
# the local token so the next call is unauthenticated rather than silently still you.)
cmd_logout() {
    local file
    file="$(cli_session_file)"
    if [ -e "$file" ]; then
        rm -f "$file"
        echo "Logged out — removed ${file}."
    else
        echo "Not logged in (no ${file})."
    fi
}

case "${1:-help}" in
    login)         shift; cmd_login "$@" ;;
    logout)        shift; cmd_logout "$@" ;;
    invalidate-password) shift; cmd_invalidate_password "$@" ;;
    whoami|config|status) shift; cmd_whoami "$@" ;;
    requests)      shift; cmd_requests "$@" ;;
    request)       shift; cmd_request "$@" ;;
    approve)       shift; cmd_approve "$@" ;;
    reject)        shift; cmd_reject "$@" ;;
    transfer)      shift; cmd_transfer "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v)  echo "aimaestro-governance.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
