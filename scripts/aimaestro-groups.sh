#!/usr/bin/env bash
# =============================================================================
# AI Maestro Groups CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro groups API. Plugins call
# THIS script, never the HTTP API directly (R23): the skill-facing CLI here is
# immutable, while the server API behind it may change freely. New capability =
# new subcommand or new optional flag only.
#
# WHY THIS EXISTS. Groups had five live routes and ZERO CLI surface, so CORE's
# team-governance skill documented the operation and then told the agent not to
# do it — the `DECOUPLE-BLOCKED` marker at
# `skills/team-governance/references/REFERENCE.md:58` (ai-maestro#64, residual 6).
# Under R23.8 an unannounced verb formally does not exist, so a plugin that needs
# groups is pushed back toward `/api/*` — or, correctly, blocks. It blocked.
#
# GROUPS ARE NOT TEAMS, and the difference is why the authorization here is
# simpler than in `aimaestro-teams.sh`. A team is a governed structure: closed
# messaging, an ACL, a COS, a kanban board — so creating or deleting one is a
# governance action carrying the governance password. A group is a lightweight,
# unstructured collection of agents used for fan-out notification. It confers no
# authority, so per R20 every route here is **authentication required,
# governance-FREE**: an agent authenticates with its AID and that is the whole
# check. There is NO --password flag on any subcommand, deliberately — adding one
# would imply a governance gate the server does not have, and R32.3 forbids the
# password passing through a model regardless.
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).
#
# Usage:
#   aimaestro-groups.sh list
#   aimaestro-groups.sh show <groupId>
#   aimaestro-groups.sh create --name N [--description D] [--subscribers u1,u2]
#   aimaestro-groups.sh update <groupId> [--name N] [--description D] [--subscribers u1,u2]
#   aimaestro-groups.sh delete <groupId>
#   aimaestro-groups.sh subscribe <groupId> <agentUUID>
#   aimaestro-groups.sh unsubscribe <groupId> <agentUUID>
#   aimaestro-groups.sh notify <groupId> --message M [--priority low|normal|high|urgent]
#
# =============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
# _api METHOD PATH [json_body]  — identical contract to aimaestro-teams.sh.
# Prints body on 2xx; "Error: HTTP <code> — <.error>" + return 1 on >=400.
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

    # Fail closed: an unparseable/missing HTTP status must be an error, never a
    # silently-printed "success" body — otherwise the [ -ge 400 ] test is a no-op
    # and garbage flows downstream as if it were a 2xx response.
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

# Build a JSON array of strings from a comma-separated list. Empty → "[]".
_csv_to_json_array() {
    local csv="${1:-}"
    if [ -z "$csv" ]; then echo '[]'; return 0; fi
    printf '%s' "$csv" | jq -Rc 'split(",") | map(select(length > 0))'
}

_check_id() {
    local id="${1:-}"
    [ -z "$id" ] && { echo "Error: groupId required" >&2; return 1; }
    return 0
}

show_help() {
    cat <<'EOF'
aimaestro-groups.sh — AI Maestro groups CLI

Groups are lightweight, unstructured agent collections used for fan-out
notification. They are NOT teams: a group confers no authority, has no ACL,
no chief-of-staff and no kanban board. Every subcommand is authenticated and
governance-FREE (R20) — there is deliberately no --password flag anywhere.

Commands:
  list                          List all groups
  show <groupId>                Show one group
  create --name N [flags]       Create a group
      --description D
      --subscribers u1,u2       comma-separated agent UUIDs
  update <groupId> [flags]      Update a group (PUT)
      --name N | --description D | --subscribers u1,u2
  delete <groupId>              Delete a group
  subscribe <groupId> <agentUUID>     Add one subscriber
  unsubscribe <groupId> <agentUUID>   Remove one subscriber
  notify <groupId> --message M [--priority P]
                                Notify every subscriber
                                --priority low|normal|high|urgent (default normal)
  help

Environment:
  AID_AUTH               Bearer token for agent callers
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough (optional)
  AIMAESTRO_API_BASE     Override the API base URL (default: this host, loopback)

Examples:
  aimaestro-groups.sh create --name "release-watchers" --description "notified on publish"
  aimaestro-groups.sh subscribe 1b4c… 9f2e…
  aimaestro-groups.sh notify 1b4c… --message "v3.6.0 published" --priority high
EOF
}

cmd_list() { _api GET "/api/groups"; }

cmd_show() {
    local id="${1:-}"; _check_id "$id" || return 1
    _api GET "/api/groups/${id}"
}

cmd_create() {
    local name="" description="" subscribers="" have_subs=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)        name="$2";        shift 2 ;;
            --description) description="$2"; shift 2 ;;
            --subscribers) subscribers="$2"; have_subs=1; shift 2 ;;
            *) echo "Error: unknown flag for 'create': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$name" ] && { echo "Error: create requires --name" >&2; return 1; }

    # Build the body from ONLY the flags actually given. The route's schema is
    # .strict(), so an unsolicited key is a 400 rather than an ignored field —
    # sending `description: ""` for an omitted flag would be a validation error,
    # not a harmless default.
    local body
    body="$(jq -nc --arg n "$name" --arg d "$description" \
        --argjson s "$(_csv_to_json_array "$subscribers")" --argjson hs "$have_subs" '
        {name: $n}
        + (if $d  != ""  then {description: $d} else {} end)
        + (if $hs == 1   then {subscriberIds: $s} else {} end)')"
    _api POST "/api/groups" "$body"
}

cmd_update() {
    local id="${1:-}"; _check_id "$id" || return 1
    shift
    local name="" description="" subscribers="" have_name=0 have_desc=0 have_subs=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)        name="$2";        have_name=1; shift 2 ;;
            --description) description="$2"; have_desc=1; shift 2 ;;
            --subscribers) subscribers="$2"; have_subs=1; shift 2 ;;
            *) echo "Error: unknown flag for 'update': $1" >&2; return 1 ;;
        esac
    done
    if [ "$have_name" -eq 0 ] && [ "$have_desc" -eq 0 ] && [ "$have_subs" -eq 0 ]; then
        echo "Error: update requires at least one of --name, --description, --subscribers" >&2
        return 1
    fi

    # Every field is optional on PUT, so send only what was asked for. A blanket
    # body would silently CLEAR the fields the caller did not mention.
    local body
    body="$(jq -nc --arg n "$name" --arg d "$description" \
        --argjson s "$(_csv_to_json_array "$subscribers")" \
        --argjson hn "$have_name" --argjson hd "$have_desc" --argjson hs "$have_subs" '
        {}
        + (if $hn == 1 then {name: $n} else {} end)
        + (if $hd == 1 then {description: $d} else {} end)
        + (if $hs == 1 then {subscriberIds: $s} else {} end)')"
    _api PUT "/api/groups/${id}" "$body"
}

cmd_delete() {
    local id="${1:-}"; _check_id "$id" || return 1
    _api DELETE "/api/groups/${id}"
}

# subscribe / unsubscribe share a shape: <groupId> <agentUUID> → {agentId}.
_membership_verb() {
    local verb="$1"; shift
    local id="${1:-}"; _check_id "$id" || return 1
    local agent="${2:-}"
    [ -z "$agent" ] && { echo "Error: ${verb} requires <agentUUID>" >&2; return 1; }
    local body
    body="$(jq -nc --arg a "$agent" '{agentId: $a}')"
    _api POST "/api/groups/${id}/${verb}" "$body"
}

cmd_subscribe()   { _membership_verb subscribe   "$@"; }
cmd_unsubscribe() { _membership_verb unsubscribe "$@"; }

cmd_notify() {
    local id="${1:-}"; _check_id "$id" || return 1
    shift
    local message="" priority=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --message)  message="$2";  shift 2 ;;
            --priority) priority="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'notify': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$message" ] && { echo "Error: notify requires --message" >&2; return 1; }

    # Validate the enum HERE rather than letting the server 400. The route's
    # z.enum rejects an unknown value, but a caller reading only this CLI's help
    # should not have to make a network round-trip to learn it typed "urgentt" —
    # the ai-maestro#114 lesson: an unmatchable argument must fail before the
    # request, and the error must NAME the valid set.
    if [ -n "$priority" ]; then
        case "$priority" in
            low|normal|high|urgent) ;;
            *) echo "Error: --priority must be one of: low, normal, high, urgent (got '${priority}')" >&2
               return 1 ;;
        esac
    fi

    local body
    body="$(jq -nc --arg m "$message" --arg p "$priority" '
        {message: $m} + (if $p != "" then {priority: $p} else {} end)')"
    _api POST "/api/groups/${id}/notify" "$body"
}

case "${1:-help}" in
    list)        shift; cmd_list "$@" ;;
    show)        shift; cmd_show "$@" ;;
    create)      shift; cmd_create "$@" ;;
    update)      shift; cmd_update "$@" ;;
    delete)      shift; cmd_delete "$@" ;;
    subscribe)   shift; cmd_subscribe "$@" ;;
    unsubscribe) shift; cmd_unsubscribe "$@" ;;
    notify)      shift; cmd_notify "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-groups.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
