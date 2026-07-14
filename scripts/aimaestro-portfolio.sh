#!/usr/bin/env bash
# =============================================================================
# AI Maestro Portfolio CLI — mint, list, VERIFY, revoke approval/mandate tokens
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro portfolio API (R28: the
# per-agent "secure enclave" holding the approval and mandate tokens that are the
# THIRD authorization check, after (1) AID identity and (2) TITLE privilege).
# Plugins call THIS script, never the HTTP API directly.
#
# WHY `verify` EXISTS (ai-maestro#47, ask 2). Governance rule R41 says an approval
# or mandate is "signed, verifiable, binding". Two of those were already true; the
# middle one was not. The only evidence a receiving agent had that "the MANAGER
# approved this" was an `## Approval log` line in a git-tracked file — auditable,
# and forgeable by anyone with repo write. `verify` is the third party an agent can
# ask instead: the server re-checks the host's Ed25519 signature over the token,
# that the token is anchored in the host-signed ledger (R34), that its issuer STILL
# holds the title it minted under, and that it is not expired / consumed / revoked.
#
# `verify` EXITS NON-ZERO WHEN THE VERDICT IS INVALID. That is the whole contract —
# it is what lets an agent write:
#
#     aimaestro-portfolio.sh verify --subject "$ME" --token "$TOK" --binds K3QX9P2W \
#       || { echo "unverified mandate — refusing to act"; exit 1; }
#
# ASK THE SPECIFIC QUESTION. `--binds <trdd-id>` turns "is this token real?" into
# "is this an approval FOR THIS CARD?". The vague question is the one a token
# replayed from another card passes.
#
# Auth: agent callers export AID_AUTH (Bearer). The portfolio routes are AGENT-
# PRIMARY (R32) — an agent authorizes by AID + title and faces NO sudo gate here.
#
# Usage:
#   aimaestro-portfolio.sh mint   --subject <agent> --kind approval|mandate
#                                 --scope <resource:action>
#                                 [--binds <trdd-id>] [--binds-agent <id>]
#                                 [--binds-team <id>] [--ttl <seconds>]
#   aimaestro-portfolio.sh list   --subject <agent>
#   aimaestro-portfolio.sh verify --subject <agent> --token <uuid>
#                                 [--binds <trdd-id>] [--binds-agent <id>]
#                                 [--binds-team <id>] [--scope <resource:action>]
#                                 [--json]
#   aimaestro-portfolio.sh revoke --subject <agent> --token <uuid>
#
# `--subject` is the agent whose enclave HOLDS the token (the empowered agent),
# not the issuer.
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

# Exit code reserved for "the server answered, and the verdict is INVALID".
# Distinct from 1 (a usage/transport/HTTP failure) on purpose: a caller must be
# able to tell "this mandate is not authentic" from "I could not reach the
# verifier". Treating those the same is how a verification outage silently becomes
# a verification bypass — or, just as bad, a fleet-wide refusal to act.
readonly EXIT_INVALID=2

# _api METHOD PATH [BODY] — prints the response body, non-zero on HTTP >= 400.
_api() {
    local method="$1" path="$2" body="${3:-}"
    local base
    base="$(get_api_base)"
    local -a auth_args=()
    get_auth_args auth_args

    local resp code out
    if [ -n "$body" ]; then
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" \
            -H "Content-Type: application/json" -d "$body" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    else
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${base}${path}")" || {
            echo "Error: request to ${path} failed (network)" >&2; return 1; }
    fi

    code="$(printf '%s' "$resp" | tail -n1)"
    out="$(printf '%s' "$resp" | sed '$d')"

    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from ${path} (no HTTP status code)" >&2
        return 1
    fi

    if [ "$code" -ge 400 ]; then
        # 404 from `verify` is a real ANSWER, not a transport failure: the token id
        # is not in that enclave. The caller (cmd_verify) renders it as an INVALID
        # verdict; every other 4xx/5xx is a genuine error.
        if [ "$code" = "404" ] && [ "${_API_ALLOW_404:-0}" = "1" ]; then
            printf '%s\n' "$out"
            return 0
        fi
        local err
        err="$(printf '%s' "$out" | jq -r '.error // .message // empty' 2>/dev/null)"
        echo "Error: HTTP ${code}${err:+ — ${err}}" >&2
        if [ "$code" = "401" ] || [ "$code" = "403" ]; then
            echo "Hint: agents export AID_AUTH=\"\$(aid-auth.sh)\"; humans run 'aimaestro-governance.sh login' once." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}

_urlencode() { printf '%s' "$1" | jq -sRr @uri; }

_check_uuid() {
    local id="${1:-}"
    [ -z "$id" ] && { echo "Error: --token <uuid> required" >&2; return 1; }
    if [[ ! "$id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        echo "Error: invalid token id '${id}' (expected a UUID)" >&2
        return 1
    fi
}

_check_trdd_id() {
    local id="${1:-}"
    if [[ ! "$id" =~ ^[A-Za-z0-9]{8}$ ]]; then
        echo "Error: invalid TRDD id '${id}' (expected 8-char base36, e.g. K3QX9P2W)" >&2
        return 1
    fi
}

_require_subject() {
    [ -n "${1:-}" ] || { echo "Error: --subject <agent-id> required" >&2; return 1; }
}

show_help() {
    cat <<'EOF'
aimaestro-portfolio.sh — AI Maestro portfolio CLI (R28 approval/mandate tokens)

Commands:
  mint   --subject A --kind K --scope S    Mint a token INTO agent A's enclave
      --kind approval|mandate              approval = one-shot; mandate = standing
      --scope <resource:action>            e.g. agent:create, trdd:approve, team:*
      --binds <trdd-id>                    Pin to ONE TRDD (8-char base36)
      --binds-agent <id> / --binds-team <id>   Pin to one agent / team
      --ttl <seconds>                      Lifetime (approval ≤ 1h, mandate ≤ 30d)
  list   --subject A                       List agent A's ACTIVE tokens
  verify --subject A --token <uuid>        VERIFY a token; the reason it exists
      --binds <trdd-id>                    Ask the SPECIFIC question: is this an
                                           approval for THIS card?
      --binds-agent <id> / --binds-team <id>
      --scope <resource:action>            Also require this scope
      --json                               Print the raw verdict JSON
  revoke --subject A --token <uuid>        Revoke a token (issuer or owner only)
  help

EXIT CODES (verify):
  0   VALID    — signature, ledger anchor, issuer title, status, expiry all pass
                 (and the token binds what you asked about)
  2   INVALID  — the server answered and the token does NOT verify
  1   ERROR    — usage, transport, or HTTP failure: the verdict is UNKNOWN

  0 vs 2 vs 1 is the point: "not authentic" and "could not ask" demand different
  responses, and collapsing them turns a verifier outage into a verifier bypass.

Environment:
  AID_AUTH             Bearer token for agent callers (export AID_AUTH="$(aid-auth.sh)")
  AIMAESTRO_API_BASE   Override the API base URL (default: this host)
EOF
}

cmd_mint() {
    local subject="" kind="" scope="" trdd="" agent="" team="" ttl=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --subject)     subject="$2"; shift 2 ;;
            --kind)        kind="$2";    shift 2 ;;
            --scope)       scope="$2";   shift 2 ;;
            --binds)       trdd="$2";    shift 2 ;;
            --binds-agent) agent="$2";   shift 2 ;;
            --binds-team)  team="$2";    shift 2 ;;
            --ttl)         ttl="$2";     shift 2 ;;
            *) echo "Error: unknown flag for 'mint': $1" >&2; return 1 ;;
        esac
    done
    _require_subject "$subject" || return 1
    case "$kind" in
        approval|mandate) ;;
        "") echo "Error: mint requires --kind approval|mandate" >&2; return 1 ;;
        *)  echo "Error: invalid --kind '${kind}' (approval|mandate)" >&2; return 1 ;;
    esac
    if [ -z "$scope" ] || [[ "$scope" != *:* ]]; then
        echo "Error: mint requires --scope <resource:action> (e.g. trdd:approve)" >&2; return 1
    fi
    [ -n "$trdd" ] && { _check_trdd_id "$trdd" || return 1; }
    if [ -n "$ttl" ] && [[ ! "$ttl" =~ ^[0-9]+$ ]]; then
        echo "Error: --ttl must be a positive integer (seconds)" >&2; return 1
    fi

    local body
    body="$(jq -nc --arg k "$kind" --arg s "$scope" --arg t "$trdd" \
        --arg a "$agent" --arg m "$team" --arg ttl "$ttl" '
        {kind: $k, scope: $s}
        + (if $t   != "" then {target_trdd_id:  ($t | ascii_upcase)} else {} end)
        + (if $a   != "" then {target_agent_id: $a} else {} end)
        + (if $m   != "" then {target_team_id:  $m} else {} end)
        + (if $ttl != "" then {ttl_seconds: ($ttl | tonumber)} else {} end)')"
    _api POST "/api/agents/$(_urlencode "$subject")/portfolio" "$body"
}

cmd_list() {
    local subject=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --subject) subject="$2"; shift 2 ;;
            *) echo "Error: unknown flag for 'list': $1" >&2; return 1 ;;
        esac
    done
    _require_subject "$subject" || return 1
    _api GET "/api/agents/$(_urlencode "$subject")/portfolio"
}

cmd_revoke() {
    local subject="" token=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --subject) subject="$2"; shift 2 ;;
            --token)   token="$2";   shift 2 ;;
            *) echo "Error: unknown flag for 'revoke': $1" >&2; return 1 ;;
        esac
    done
    _require_subject "$subject" || return 1
    _check_uuid "$token" || return 1
    _api DELETE "/api/agents/$(_urlencode "$subject")/portfolio?token_id=$(_urlencode "$token")"
}

cmd_verify() {
    local subject="" token="" trdd="" agent="" team="" scope="" as_json=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --subject)     subject="$2"; shift 2 ;;
            --token)       token="$2";   shift 2 ;;
            --binds)       trdd="$2";    shift 2 ;;
            --binds-agent) agent="$2";   shift 2 ;;
            --binds-team)  team="$2";    shift 2 ;;
            --scope)       scope="$2";   shift 2 ;;
            --json)        as_json=1;    shift ;;
            *) echo "Error: unknown flag for 'verify': $1" >&2; return 1 ;;
        esac
    done
    _require_subject "$subject" || return 1
    _check_uuid "$token" || return 1
    [ -n "$trdd" ] && { _check_trdd_id "$trdd" || return 1; }

    local -a params=("token_id=$(_urlencode "$token")")
    [ -n "$trdd" ]  && params+=("binds=$(_urlencode "$trdd")")
    [ -n "$agent" ] && params+=("binds_agent=$(_urlencode "$agent")")
    [ -n "$team" ]  && params+=("binds_team=$(_urlencode "$team")")
    [ -n "$scope" ] && params+=("scope=$(_urlencode "$scope")")
    # Join in a SUBSHELL so IFS='&' dies with it. A `local IFS='&'` would stay set
    # for the rest of this function and silently re-split every later expansion.
    local qs
    qs="$(IFS='&'; printf '%s' "${params[*]}")"

    # A 404 here means "no such token in that enclave" — an ANSWER (invalid), not a
    # transport failure. Scoped to this function so no later call inherits it.
    local _API_ALLOW_404=1
    local out
    out="$(_api GET "/api/agents/$(_urlencode "$subject")/portfolio/verify?${qs}")" || return 1

    if [ "$as_json" = "1" ]; then
        printf '%s\n' "$out" | jq .
    else
        printf '%s\n' "$out" | jq -r '
          if .valid then
            "VALID   token \(.token_id)",
            "  binds  \(.binds.kind) scope=\(.binds.scope)"
              + (if .binds.target_trdd_id  then " trdd=\(.binds.target_trdd_id)"  else "" end)
              + (if .binds.target_agent_id then " agent=\(.binds.target_agent_id)" else "" end)
              + (if .binds.target_team_id  then " team=\(.binds.target_team_id)"  else "" end),
            "  issuer \(.binds.issuer_agent_id) (\(.binds.issuer_title)), expires \(.binds.expires_at // "never")"
          else
            "INVALID token \(.token_id)",
            (.reasons[] | "  ✗ \(.)")
          end'
    fi

    # THE CONTRACT: a failed verification is a NON-ZERO exit. A verifier that always
    # exits 0 is not a verifier — every `verify || refuse` guard built on it silently
    # passes, and the forgery it was installed to catch sails straight through.
    if [ "$(printf '%s' "$out" | jq -r '.valid // false')" = "true" ]; then
        return 0
    fi
    return $EXIT_INVALID
}

case "${1:-help}" in
    mint)   shift; cmd_mint "$@" ;;
    list)   shift; cmd_list "$@" ;;
    verify) shift; cmd_verify "$@" ;;
    revoke) shift; cmd_revoke "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-portfolio.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
