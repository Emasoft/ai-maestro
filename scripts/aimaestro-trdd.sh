#!/usr/bin/env bash
# =============================================================================
# AI Maestro TRDD CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro TRDD-file API. Plugins (the
# janitor, MANAGER, ARCHITECT, every governance agent) call THIS script, never
# the HTTP API directly: the skill-facing CLI here is immutable, while the server
# API behind it may change freely.
#
# Operates on a project's `design/{proposals,tasks,archived,refused}/*.md` corpus
# — the SSOT of the 3-pillars task system. The lifecycle verbs perform the real
# `git mv` + frontmatter edit + `## Approval log` append the TRDD overlay rules
# require; they do NOT commit. Commit the result yourself.
#
# Which project? `--agent <uuid|name>` selects that agent's `<workdir>/design`.
# Omit it and the server's own repo is used.
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# Every mutating verb (edit/approve/refuse/promote/archive) hits a strict route:
# a USER caller must supply AIMAESTRO_SUDO_TOKEN, an AGENT caller authorizes by
# AID + governance title (the R32 dual-path) and needs none.
#
# Usage:
#   aimaestro-trdd.sh search [--column C] [--id I] [--keyword K] [--zone Z] [--agent A]
#   aimaestro-trdd.sh read <trdd-id> [--agent A]
#   aimaestro-trdd.sh edit <trdd-id> --set key=value [--set key=value ...] [--agent A]
#   aimaestro-trdd.sh approve <trdd-id> [--approver W] [--tier N] [--rationale R] [--agent A]
#   aimaestro-trdd.sh refuse  <trdd-id> [--approver W] [--tier N] [--reason R]    [--agent A]
#   aimaestro-trdd.sh promote <trdd-id> --column C [--note N] [--approver W]      [--agent A]
#   aimaestro-trdd.sh archive <trdd-id> --state completed|cancelled|superseded
#       [--reason R] [--superseded-by ID] [--approver W] [--agent A]
#
# <trdd-id> is the 8-char UPPERCASE base36 id (matched case-insensitively).
#
# The three lifecycle verbs are NOT interchangeable:
#   approve  proposal → planned   (design/proposals/ → design/tasks/)
#   promote  advance `column` forward in place, inside design/tasks/
#   archive  once-approved → terminal (→ design/archived/); `failed` is retryable
#            and is deliberately NOT an archive state.
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

    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from ${path} (no HTTP status code)" >&2
        return 1
    fi

    if [ "$code" -ge 400 ]; then
        local err
        err="$(printf '%s' "$out" | jq -r '.error // .message // empty' 2>/dev/null)"
        echo "Error: HTTP ${code}${err:+ — ${err}}" >&2
        if [ "$code" = "401" ] || [ "$code" = "403" ]; then
            echo "Hint: agents authenticate with AID_AUTH (export AID_AUTH=\"\$(aid-auth.sh)\")." >&2
            echo "      Humans: run 'aimaestro-governance.sh login' once. Strict routes also need AIMAESTRO_SUDO_TOKEN." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}

# The 8-char base36 id. Validate before it reaches a URL path segment.
_check_trdd_id() {
    local id="${1:-}"
    [ -z "$id" ] && { echo "Error: trdd-id required" >&2; return 1; }
    if [[ ! "$id" =~ ^[A-Za-z0-9]{8}$ ]]; then
        echo "Error: invalid TRDD id '${id}' (expected 8-char base36, e.g. K3QX9P2W)" >&2
        return 1
    fi
}

_urlencode() { printf '%s' "$1" | jq -sRr @uri; }

show_help() {
    cat <<'EOF'
aimaestro-trdd.sh — AI Maestro TRDD-file CLI (the 3-pillars task SSOT)

Commands:
  search [flags]                 Search a project's TRDD corpus
      --column C                 Filter by `column:` (dev, testing, blocked, …)
      --id I                     Filter by 8-char TRDD id
      --keyword K                Free-text match on title + body
      --zone Z                   proposals | tasks | archived | refused
  read <trdd-id>                 Print one TRDD (frontmatter + body)
  verify <trdd-id>               Is this card's approval REAL? Checks the
      --json                     host-signed, ledger-anchored token pinned to it —
                                 not the (forgeable) prose in the file.
                                 EXIT 0 = verified · 2 = NOT verified · 1 = error.
  edit <trdd-id> --set k=v ...   Edit frontmatter fields IN PLACE (no folder move)
  approve <trdd-id>              proposal → planned, git mv proposals/ → tasks/
      --approver W --tier N --rationale R
  refuse <trdd-id>               proposal → refused, git mv → refused/
      --approver W --tier N --reason R
  promote <trdd-id> --column C   Advance `column` forward inside tasks/ (in place)
      --note N --approver W
  archive <trdd-id> --state S    Terminal move → archived/ (S = completed |
      --reason R                 cancelled | superseded). `failed` is NOT a state
      --superseded-by ID         here — it stays in tasks/ and is retried.
      --approver W
  help

Global flag:
  --agent <uuid|name>            Operate on that agent's <workdir>/design corpus
                                 (default: the server's own repo)

Mutating verbs are strict routes: AIMAESTRO_SUDO_TOKEN for USER callers; agent
callers authorize by AID_AUTH + governance title. Nothing is committed for you.

Environment:
  AID_AUTH               Bearer token for agent callers (REQUIRED — no localhost exemption)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough for strict routes
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

cmd_search() {
    local column="" id="" keyword="" zone="" agent=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --column)  column="$2";  shift 2 ;;
            --id)      id="$2";      shift 2 ;;
            --keyword|-k|-q) keyword="$2"; shift 2 ;;
            --zone)    zone="$2";    shift 2 ;;
            --agent)   agent="$2";   shift 2 ;;
            *) echo "Error: unknown flag for 'search': $1" >&2; return 1 ;;
        esac
    done
    local -a params=()
    [ -n "$column" ]  && params+=("column=$(_urlencode "$column")")
    [ -n "$id" ]      && params+=("id=$(_urlencode "$id")")
    [ -n "$keyword" ] && params+=("keyword=$(_urlencode "$keyword")")
    [ -n "$zone" ]    && params+=("zone=$(_urlencode "$zone")")
    [ -n "$agent" ]   && params+=("agentId=$(_urlencode "$agent")")
    local path="/api/trdd"
    if [ ${#params[@]} -gt 0 ]; then
        local IFS='&'
        path="${path}?${params[*]}"
    fi
    _api GET "$path"
}

cmd_read() {
    local id="${1:-}"; shift || true
    _check_trdd_id "$id" || return 1
    local agent=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --agent) agent="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'read': $1" >&2; return 1 ;;
        esac
    done
    local path="/api/trdd/${id}"
    [ -n "$agent" ] && path="${path}?agentId=$(_urlencode "$agent")"
    _api GET "$path"
}

# VERIFY a card's approval/mandate — the reason ai-maestro#47 exists.
#
# EXITS NON-ZERO WHEN THE APPROVAL DOES NOT VERIFY (2 = INVALID, distinct from
# 1 = ERROR). That is the entire contract: it is what lets an agent handed a
# mandate write
#
#     aimaestro-trdd.sh verify "$CARD" || { echo "unverified — refusing"; exit 1; }
#
# instead of believing a line of prose in a file that anyone with repo write can
# type. A verifier that always exits 0 is not a verifier.
cmd_verify() {
    local id="${1:-}"; shift || true
    _check_trdd_id "$id" || return 1
    local agent="" as_json=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --agent) agent="$2"; shift 2 ;;
            --json)  as_json=1;  shift ;;
            *) echo "Error: unknown flag for 'verify': $1" >&2; return 1 ;;
        esac
    done
    local path="/api/trdd/${id}/verify"
    [ -n "$agent" ] && path="${path}?agentId=$(_urlencode "$agent")"

    local out
    out="$(_api GET "$path")" || return 1

    if [ "$as_json" = "1" ]; then
        printf '%s\n' "$out" | jq .
    else
        printf '%s\n' "$out" | jq -r '
          if .verified then
            "VERIFIED  TRDD-\(.trdd_id)",
            (if .token_id then
               "  approved by \(.issuer_agent_id) (\(.issuer_title)) — requires \(.min_approval_requirement)",
               "  token \(.token_id): host-signed, ledger-anchored, pinned to this card"
             else
               "  \(.reasons[0] // "no approval required")"
             end)
          else
            "UNVERIFIED  TRDD-\(.trdd_id)",
            (.reasons[] | "  ✗ \(.)")
          end'
    fi

    if [ "$(printf '%s' "$out" | jq -r '.verified // false')" = "true" ]; then
        return 0
    fi
    return 2
}

cmd_edit() {
    local id="${1:-}"; shift || true
    _check_trdd_id "$id" || return 1
    local agent="" fields="{}"
    while [ $# -gt 0 ]; do
        case "$1" in
            --set)
                local pair="$2"
                # Split on the FIRST '=' only: a value may legitimately contain
                # '=' (a URL query, a base64 pad). key=value with an empty key
                # is rejected; an empty value is allowed (it clears the field).
                if [[ "$pair" != *=* ]]; then
                    echo "Error: --set expects key=value, got '${pair}'" >&2; return 1
                fi
                local k="${pair%%=*}" v="${pair#*=}"
                if [ -z "$k" ]; then
                    echo "Error: --set key must not be empty" >&2; return 1
                fi
                fields="$(printf '%s' "$fields" | jq -c --arg k "$k" --arg v "$v" '. + {($k): $v}')"
                shift 2 ;;
            --agent) agent="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'edit': $1" >&2; return 1 ;;
        esac
    done
    if [ "$fields" = "{}" ]; then
        echo "Error: edit requires at least one --set key=value" >&2; return 1
    fi
    local body
    body="$(jq -nc --argjson f "$fields" --arg a "$agent" '
        {fields: $f} + (if $a != "" then {agentId: $a} else {} end)')"
    _api PATCH "/api/trdd/${id}" "$body"
}

# approve / refuse share a shape: {approver?, tier?, <rationale|reason>?, agentId?}
# Shift the two dispatcher-supplied args first, THEN read the id: a bare
# `shift 3` aborts the whole script under `set -e` when the caller omitted the
# id, which would swallow the useful "trdd-id required" message.
_gate_verb() {
    local verb="$1" reason_key="$2"; shift 2
    local id="${1:-}"
    _check_trdd_id "$id" || return 1
    shift
    local approver="" tier="" reason="" agent=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --approver) approver="$2"; shift 2 ;;
            --tier)     tier="$2";     shift 2 ;;
            --rationale|--reason) reason="$2"; shift 2 ;;
            --agent)    agent="$2";    shift 2 ;;
            *) echo "Error: unknown flag for '${verb}': $1" >&2; return 1 ;;
        esac
    done
    if [ -n "$tier" ] && [[ ! "$tier" =~ ^[0-9]+$ ]]; then
        echo "Error: --tier must be a number (0-3)" >&2; return 1
    fi
    local body
    body="$(jq -nc --arg ap "$approver" --arg t "$tier" --arg r "$reason" \
        --arg rk "$reason_key" --arg a "$agent" '
        {}
        + (if $ap != "" then {approver: $ap} else {} end)
        + (if $t  != "" then {tier: ($t | tonumber)} else {} end)
        + (if $r  != "" then {($rk): $r} else {} end)
        + (if $a  != "" then {agentId: $a} else {} end)')"
    _api POST "/api/trdd/${id}/${verb}" "$body"
}

cmd_promote() {
    local id="${1:-}"; shift || true
    _check_trdd_id "$id" || return 1
    local column="" note="" approver="" agent=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --column)   column="$2";   shift 2 ;;
            --note)     note="$2";     shift 2 ;;
            --approver) approver="$2"; shift 2 ;;
            --agent)    agent="$2";    shift 2 ;;
            *) echo "Error: unknown flag for 'promote': $1" >&2; return 1 ;;
        esac
    done
    [ -z "$column" ] && { echo "Error: promote requires --column <target>" >&2; return 1; }
    local body
    body="$(jq -nc --arg c "$column" --arg n "$note" --arg ap "$approver" --arg a "$agent" '
        {column: $c}
        + (if $n  != "" then {note: $n} else {} end)
        + (if $ap != "" then {approver: $ap} else {} end)
        + (if $a  != "" then {agentId: $a} else {} end)')"
    _api POST "/api/trdd/${id}/promote" "$body"
}

cmd_archive() {
    local id="${1:-}"; shift || true
    _check_trdd_id "$id" || return 1
    local state="" reason="" superseded_by="" approver="" agent=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --state)         state="$2";         shift 2 ;;
            --reason)        reason="$2";        shift 2 ;;
            --superseded-by) superseded_by="$2"; shift 2 ;;
            --approver)      approver="$2";      shift 2 ;;
            --agent)         agent="$2";         shift 2 ;;
            *) echo "Error: unknown flag for 'archive': $1" >&2; return 1 ;;
        esac
    done
    case "$state" in
        completed|cancelled|superseded) ;;
        failed)
            # Guard the single most likely misuse. `failed` is a RETRYABLE state
            # that stays in design/tasks/; archiving it would silently drop a task
            # that is meant to be retried. Giving up is an explicit `cancelled`.
            echo "Error: 'failed' is not an archive state — it is retryable and stays in design/tasks/." >&2
            echo "       To give up on it, archive with --state cancelled." >&2
            return 1 ;;
        "") echo "Error: archive requires --state completed|cancelled|superseded" >&2; return 1 ;;
        *)  echo "Error: invalid --state '${state}' (completed|cancelled|superseded)" >&2; return 1 ;;
    esac
    local body
    body="$(jq -nc --arg s "$state" --arg r "$reason" --arg sb "$superseded_by" \
        --arg ap "$approver" --arg a "$agent" '
        {state: $s}
        + (if $r  != "" then {reason: $r} else {} end)
        + (if $sb != "" then {supersededBy: $sb} else {} end)
        + (if $ap != "" then {approver: $ap} else {} end)
        + (if $a  != "" then {agentId: $a} else {} end)')"
    _api POST "/api/trdd/${id}/archive" "$body"
}

case "${1:-help}" in
    search)  shift; cmd_search "$@" ;;
    read)    shift; cmd_read "$@" ;;
    verify)  shift; cmd_verify "$@" ;;
    edit)    shift; cmd_edit "$@" ;;
    approve) shift; _gate_verb approve rationale "$@" ;;
    refuse)  shift; _gate_verb refuse reason "$@" ;;
    promote) shift; cmd_promote "$@" ;;
    archive) shift; cmd_archive "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-trdd.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
