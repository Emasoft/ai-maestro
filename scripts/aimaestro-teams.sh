#!/usr/bin/env bash
# =============================================================================
# AI Maestro Teams CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro teams API. Plugins
# (CHIEF-OF-STAFF, MANAGER, …) call THIS script, never the HTTP API directly:
# the skill-facing CLI here is immutable, while the server API behind it may
# change freely. New capability = new subcommand or new optional flag only.
#
# Team creation/deletion are governance actions: pass the governance password
# with --password (the body field the route expects). Membership changes
# (add-agent / remove-agent) are expressed as a full agentIds array on PUT —
# there is no per-agent subroute — so this CLI reads the team, edits the
# array, and writes it back.
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).
#
# Usage:
#   aimaestro-teams.sh list
#   aimaestro-teams.sh show <teamId>
#   aimaestro-teams.sh create --name N [--description D] [--agents u1,u2]
#       [--type T] [--cos UUID] [--password P] [--gh-owner O --gh-repo R]
#   aimaestro-teams.sh update <teamId> [--name N] [--description D]
#       [--agents u1,u2] [--orchestrator UUID|null] [--gh-owner O --gh-repo R]
#   aimaestro-teams.sh delete <teamId> [--password P] [--delete-agents]
#   aimaestro-teams.sh add-agent <teamId> <agentUUID> [--password P]
#   aimaestro-teams.sh remove-agent <teamId> <agentUUID> [--password P]
#   aimaestro-teams.sh kanban-config <teamId> --get | --set <columns-json> | --set-file <path>
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
# _api METHOD PATH [json_body]  — see aimaestro-governance.sh for full notes.
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

    if [ "$code" -ge 400 ] 2>/dev/null; then
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

show_help() {
    cat <<'EOF'
aimaestro-teams.sh — AI Maestro teams CLI

Commands:
  list                          List all teams
  show <teamId>                 Show one team
  create --name N [flags]       Create a team (governance action)
      --description D
      --agents u1,u2            comma-separated agent UUIDs
      --type T
      --cos UUID                chief-of-staff agent UUID
      --password P              governance password (required for agent callers)
      --gh-owner O --gh-repo R  attach a GitHub project
  update <teamId> [flags]       Update a team (PUT)
      --name N | --description D | --agents u1,u2
      --orchestrator UUID|null  set/clear the orchestrator slot
      --gh-owner O --gh-repo R
  delete <teamId> [flags]       Delete a team (governance action)
      --password P              governance password
      --delete-agents           cascade-delete the team's agents
  add-agent <teamId> <agentUUID>    [--password P]   add one member (read+PUT)
  remove-agent <teamId> <agentUUID> [--password P]   remove one member (read+PUT)
  kanban-config <teamId> [flags]    Get or set the team's kanban columns
      --get                     print the current column config
      --set <columns-json>      set columns (inline JSON array, 1..20 items)
      --set-file <path>         set columns from a JSON-array file
  help

Environment:
  AID_AUTH               Bearer token for agent callers (optional on localhost)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough for strict routes (optional)
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

cmd_list() { _api GET "/api/teams"; }

cmd_show() {
    local id="${1:-}"
    [ -z "$id" ] && { echo "Error: teamId required" >&2; return 1; }
    _api GET "/api/teams/${id}"
}

cmd_create() {
    local name="" description="" agents="" type="" cos="" password="" gh_owner="" gh_repo=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)        name="$2";        shift 2 ;;
            --description) description="$2"; shift 2 ;;
            --agents)      agents="$2";      shift 2 ;;
            --type)        type="$2";        shift 2 ;;
            --cos)         cos="$2";         shift 2 ;;
            --password)    password="$2";    shift 2 ;;
            --gh-owner)    gh_owner="$2";    shift 2 ;;
            --gh-repo)     gh_repo="$2";     shift 2 ;;
            *) echo "Error: unknown flag for 'create': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$name" ] && { echo "Error: --name required" >&2; return 1; }
    if { [ -n "$gh_owner" ] && [ -z "$gh_repo" ]; } || { [ -z "$gh_owner" ] && [ -n "$gh_repo" ]; }; then
        echo "Error: --gh-owner and --gh-repo must be given together" >&2; return 1
    fi
    local agents_json
    agents_json="$(_csv_to_json_array "$agents")"
    # Start from required name, then conditionally add each optional field so the
    # body carries only what the caller actually set (the route uses .strict()).
    local body
    body="$(jq -nc \
        --arg name "$name" --arg desc "$description" --argjson agents "$agents_json" \
        --arg type "$type" --arg cos "$cos" --arg password "$password" \
        --arg gho "$gh_owner" --arg ghr "$gh_repo" '
        {name: $name}
        + (if $desc     != "" then {description: $desc} else {} end)
        + (if ($agents | length) > 0 then {agentIds: $agents} else {} end)
        + (if $type     != "" then {type: $type} else {} end)
        + (if $cos      != "" then {chiefOfStaffId: $cos} else {} end)
        + (if $password != "" then {governancePassword: $password} else {} end)
        + (if $gho      != "" then {githubProject: {owner: $gho, repo: $ghr}} else {} end)')"
    _api POST "/api/teams" "$body"
}

cmd_update() {
    local id="${1:-}"; shift || true
    [ -z "$id" ] && { echo "Error: teamId required" >&2; return 1; }
    local name="" description="" agents="" agents_set="false" orchestrator="" orchestrator_set="false" gh_owner="" gh_repo=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --name)         name="$2";        shift 2 ;;
            --description)  description="$2"; shift 2 ;;
            --agents)       agents="$2"; agents_set="true"; shift 2 ;;
            --orchestrator) orchestrator="$2"; orchestrator_set="true"; shift 2 ;;
            --gh-owner)     gh_owner="$2";    shift 2 ;;
            --gh-repo)      gh_repo="$2";     shift 2 ;;
            *) echo "Error: unknown flag for 'update': $1" >&2; return 1 ;;
        esac
    done
    if { [ -n "$gh_owner" ] && [ -z "$gh_repo" ]; } || { [ -z "$gh_owner" ] && [ -n "$gh_repo" ]; }; then
        echo "Error: --gh-owner and --gh-repo must be given together" >&2; return 1
    fi
    # orchestrator: literal "null" clears the slot (JSON null); a UUID sets it.
    local orch_json="null"
    if [ "$orchestrator_set" = "true" ] && [ "$orchestrator" != "null" ]; then
        orch_json="$(jq -nc --arg o "$orchestrator" '$o')"
    fi
    local agents_json="[]"
    [ "$agents_set" = "true" ] && agents_json="$(_csv_to_json_array "$agents")"
    local body
    body="$(jq -nc \
        --arg name "$name" --arg desc "$description" \
        --argjson agents "$agents_json" --arg agents_set "$agents_set" \
        --argjson orch "$orch_json" --arg orch_set "$orchestrator_set" \
        --arg gho "$gh_owner" --arg ghr "$gh_repo" '
        {}
        + (if $name != "" then {name: $name} else {} end)
        + (if $desc != "" then {description: $desc} else {} end)
        + (if $agents_set == "true" then {agentIds: $agents} else {} end)
        + (if $orch_set == "true" then {orchestratorId: $orch} else {} end)
        + (if $gho != "" then {githubProject: {owner: $gho, repo: $ghr}} else {} end)')"
    _api PUT "/api/teams/${id}" "$body"
}

cmd_delete() {
    local id="${1:-}"; shift || true
    [ -z "$id" ] && { echo "Error: teamId required" >&2; return 1; }
    local password="" delete_agents="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --password)      password="$2"; shift 2 ;;
            --delete-agents) delete_agents="true"; shift ;;
            *) echo "Error: unknown flag for 'delete': $1" >&2; return 1 ;;
        esac
    done
    local body
    body="$(jq -nc --arg p "$password" --argjson da "$delete_agents" '
        {}
        + (if $p != "" then {password: $p} else {} end)
        + (if $da then {deleteAgents: true} else {} end)')"
    # Always send a body (even "{}") so the route's JSON parse is satisfied.
    _api DELETE "/api/teams/${id}" "$body"
}

# add-agent / remove-agent: there is no per-agent subroute. Read the team's
# current agentIds, edit the set, and PUT the whole array back.
_edit_membership() {
    local mode="$1" id="$2" agent="$3" password="$4"
    [ -z "$id" ] || [ -z "$agent" ] && { echo "Error: teamId and agentUUID required" >&2; return 1; }
    local team
    team="$(_api GET "/api/teams/${id}")" || return 1
    local current
    current="$(printf '%s' "$team" | jq -c '.agentIds // []' 2>/dev/null)"
    [ -z "$current" ] && current='[]'
    local next
    if [ "$mode" = "add" ]; then
        next="$(printf '%s' "$current" | jq -c --arg a "$agent" '(. + [$a]) | unique')"
    else
        next="$(printf '%s' "$current" | jq -c --arg a "$agent" 'map(select(. != $a))')"
    fi
    local body
    body="$(jq -nc --argjson agents "$next" --arg p "$password" '
        {agentIds: $agents}
        + (if $p != "" then {governancePassword: $p} else {} end)')"
    _api PUT "/api/teams/${id}" "$body"
}

cmd_add_agent() {
    local id="${1:-}" agent="${2:-}"; shift 2 2>/dev/null || true
    local password=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --password) password="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'add-agent': $1" >&2; return 1 ;;
        esac
    done
    _edit_membership add "$id" "$agent" "$password"
}

cmd_remove_agent() {
    local id="${1:-}" agent="${2:-}"; shift 2 2>/dev/null || true
    local password=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --password) password="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'remove-agent': $1" >&2; return 1 ;;
        esac
    done
    _edit_membership remove "$id" "$agent" "$password"
}

# kanban-config <teamId> --get | --set <columns-json> | --set-file <path>
# GET/PUT the team's kanban column configuration (COS #11 — the CLI face of the
# Configurable Kanban Columns feature). The PUT body is {columns:[{id,label,
# color[,icon]}, …]} — 1..20 strict items, validated server-side.
cmd_kanban_config() {
    local id="${1:-}"; shift || true
    [ -z "$id" ] && { echo "Error: teamId required" >&2; return 1; }
    local mode="" columns_json="" columns_file=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --get)      mode="get"; shift ;;
            --set)      mode="set"; columns_json="$2"; shift 2 ;;
            --set-file) mode="set"; columns_file="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'kanban-config': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$mode" ] && { echo "Error: kanban-config needs --get, --set <columns-json>, or --set-file <path>" >&2; return 1; }
    if [ "$mode" = "get" ]; then
        _api GET "/api/teams/${id}/kanban-config"
    else
        if [ -n "$columns_file" ]; then
            [ -f "$columns_file" ] || { echo "Error: file not found: $columns_file" >&2; return 1; }
            columns_json="$(cat "$columns_file")"
        fi
        [ -z "$columns_json" ] && { echo "Error: --set requires a JSON array of columns (or use --set-file)" >&2; return 1; }
        if ! printf '%s' "$columns_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
            echo 'Error: columns must be a JSON array, e.g. [{"id":"todo","label":"To Do","color":"#888888"}]' >&2
            return 1
        fi
        local body
        body="$(jq -nc --argjson cols "$columns_json" '{columns: $cols}')"
        _api PUT "/api/teams/${id}/kanban-config" "$body"
    fi
}

case "${1:-help}" in
    list)         shift; cmd_list "$@" ;;
    show)         shift; cmd_show "$@" ;;
    create)       shift; cmd_create "$@" ;;
    update)       shift; cmd_update "$@" ;;
    delete)       shift; cmd_delete "$@" ;;
    add-agent)    shift; cmd_add_agent "$@" ;;
    remove-agent) shift; cmd_remove_agent "$@" ;;
    kanban-config) shift; cmd_kanban_config "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-teams.sh v1.1.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
