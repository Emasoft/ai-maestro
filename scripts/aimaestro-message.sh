#!/usr/bin/env bash
# =============================================================================
# AI Maestro inter-agent messaging CLI (TRDD-0AB76JG3)
# =============================================================================
#
# THE ONLY DOOR: inside the harness the client's own cross-session peer-messaging
# tool is DENIED in every registered agent workdir (USER directive 2026-08-20;
# enforced by the amp-only-messaging workdir invariant). Agents reach each other
# over AMP, and this CLI is the spec'd transport over the server's SendMessage
# AIO pipeline — the R6 graph gate, the sender's verified AID, and the message
# log all apply; a refusal is surfaced, never bypassed.
#
# Usage:
#   aimaestro-message.sh resolve <name-pattern>
#       Case-insensitive substring match over registered agent names.
#       stdout: one TSV row per match:  <name>\t<agent-id>\t<title>
#       Exit codes:
#         0  exactly one match
#         3  registry/transport unavailable (DISTINCT from no-match — degrade
#            loudly, never guess)
#         4  zero matches (stderr says so; stdout empty)
#         5  ambiguous — more than one match; ALL candidates still on stdout
#
#   aimaestro-message.sh send <recipient-name|--id UUID> --subject <S> --body <B|->
#                             [--priority normal|high|urgent] [--reply-to <message-id>]
#                             [--from <sender-name-or-id>] [--type <amp-type>]
#       --type defaults to notification (the full AMP set: request response
#       notification alert task status handoff ack update system).
#       --from is for the HUMAN-OWNER path only (session cookie): the route needs a
#       sender it cannot infer. An AGENT caller must NOT pass it — the server
#       overrides the sender with the AID-verified identity anyway (anti-spoofing).
#       --body - reads the body from stdin (heredoc-friendly for long approval
#       bodies). stdout on success: the message-id (record it in the TRDD
#       Approval log). Exit codes:
#         0  delivered — message-id on stdout
#         3  transport/server unreachable
#         4  recipient not found
#         6  R6 communication-graph REFUSED (403) — the server's routing hint is
#            printed verbatim on stderr; the caller's contract is to FOLLOW the
#            hint (e.g. route via its CHIEF-OF-STAFF), never to retry around it
#         7  auth missing/invalid (AID_AUTH)
#       Any other non-zero is unknown — surface it raw.
#
# Auth: agents export AID_AUTH (Bearer). Recipient-by-name resolves through the
# same registry as `resolve`; `--id` skips resolution. No verb here prints or
# accepts a credential.
#
# RELATION TO amp-send.sh (the core plugin's frozen surface): SAME pipeline, two
# doors with different contracts — amp-send is the feature-rich agent surface
# (attachments, --context JSON, native name@host addressing); THIS CLI is the
# server-owned governance surface whose whole value is the DISTINGUISHABLE exit
# codes above (a scripted caller can branch on 3/4/5/6/7, which amp-send does not
# promise). Use amp-send for ordinary agent conversation; use this for gates,
# approval loops, and any caller that must tell "no match" from "server down".
# amp-name-resolve's index-file lookup and `resolve` here differ the same way:
# the index degrades silently when absent, the registry query fails loudly.
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
    exit 3
fi

check_jq || exit 3

# Like the sibling CLIs' _api, but the HTTP status is the CALLER's to map: this
# CLI's whole contract is distinguishable exit codes (transport 3 vs not-found 4
# vs R6-refused 6 vs auth 7), so collapsing every failure to `return 1` here —
# the shape aimaestro-trdd.sh uses — would erase exactly the information the
# consumer (the MAINTAINER's approval gate) asked for.
#
# Sets: API_CODE (HTTP status) and API_OUT (body). Returns 0 iff the REQUEST
# completed (any HTTP status); returns 1 only on transport failure.
_api_raw() {
    local method="$1" path="$2" body="${3:-}"
    local base
    base="$(get_api_base)"
    local -a auth_args=()
    get_auth_args auth_args
    local resp
    if [ -n "$body" ]; then
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" -H "Content-Type: application/json" \
            -d "$body" "${base}${path}")" || return 1
    else
        resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${base}${path}")" || return 1
    fi
    API_CODE="$(printf '%s' "$resp" | tail -n1)"
    API_OUT="$(printf '%s' "$resp" | sed '$d')"
    [[ "$API_CODE" =~ ^[0-9]+$ ]] || return 1
    return 0
}

# Shared by both verbs: pattern -> TSV rows on stdout, match count in MATCHES.
# Exit contract is the resolve verb's (0/3/4/5); send reuses it for name lookup.
_resolve_rows() {
    local pattern="$1"
    if ! _api_raw GET "/api/agents"; then
        echo "Error: registry/transport unavailable — cannot resolve '${pattern}'" >&2
        return 3
    fi
    if [ "$API_CODE" = "401" ] || [ "$API_CODE" = "403" ]; then
        echo "Error: auth missing/invalid (export AID_AUTH=\"\$(aid-auth.sh)\")" >&2
        return 7
    fi
    if [ "$API_CODE" -ge 400 ]; then
        echo "Error: registry unavailable (HTTP ${API_CODE})" >&2
        return 3
    fi
    local rows
    rows="$(printf '%s' "$API_OUT" | jq -r --arg p "$pattern" '
        (.agents // [])[]
        | select((.name // "") | ascii_downcase | contains($p | ascii_downcase))
        | [.name, .id, (.governanceTitle // "")] | @tsv')" || {
        echo "Error: unparseable registry response" >&2; return 3; }
    MATCHES=0
    if [ -n "$rows" ]; then
        MATCHES="$(printf '%s\n' "$rows" | wc -l | tr -d ' ')"
        printf '%s\n' "$rows"
    fi
    if [ "$MATCHES" -eq 0 ]; then
        echo "Error: no registered agent matches '${pattern}'" >&2
        return 4
    fi
    if [ "$MATCHES" -gt 1 ]; then
        echo "Error: ambiguous — ${MATCHES} agents match '${pattern}' (candidates on stdout)" >&2
        return 5
    fi
    return 0
}

cmd_resolve() {
    local pattern="${1:-}"
    [ -z "$pattern" ] && { echo "Error: resolve requires <name-pattern>" >&2; exit 2; }
    local rc=0
    _resolve_rows "$pattern" || rc=$?
    exit "$rc"
}

cmd_send() {
    local recipient="" recipient_id="" subject="" body="" priority="normal" reply_to="" from="" mtype="notification"
    while [ $# -gt 0 ]; do
        case "$1" in
            --id)       recipient_id="$2"; shift 2 ;;
            --subject)  subject="$2"; shift 2 ;;
            --body)     body="$2"; shift 2 ;;
            --priority) priority="$2"; shift 2 ;;
            --reply-to) reply_to="$2"; shift 2 ;;
            --from)     from="$2"; shift 2 ;;
            --type)     mtype="$2"; shift 2 ;;
            -*)         echo "Error: unknown option: $1" >&2; exit 2 ;;
            *)          recipient="$1"; shift ;;
        esac
    done
    [ -z "$subject" ] && { echo "Error: --subject required" >&2; exit 2; }
    [ -z "$body" ] && { echo "Error: --body required (use '-' for stdin)" >&2; exit 2; }
    [ "$body" = "-" ] && body="$(cat)"
    case "$priority" in normal|high|urgent) ;; *)
        echo "Error: --priority must be normal|high|urgent" >&2; exit 2 ;; esac

    if [ -z "$recipient_id" ]; then
        [ -z "$recipient" ] && { echo "Error: recipient name or --id required" >&2; exit 2; }
        # Resolution failures keep the resolve verb's own codes (3/4/5/7) — a
        # not-found recipient must exit 4 whether it failed here or at the route.
        local rows rc=0
        rows="$(_resolve_rows "$recipient")" || rc=$?
        [ "$rc" -ne 0 ] && { [ -n "$rows" ] && printf '%s\n' "$rows"; exit "$rc"; }
        recipient_id="$(printf '%s' "$rows" | cut -f2)"
    else
        # --id path: validate against the registry FIRST. The route reports an
        # unknown recipient as HTTP 400 ("Message delivery failed ... No recipient
        # agent UUID"), indistinguishable by status from a malformed body — and the
        # exit-4 contract ("recipient not found") must not hang off matching an
        # error STRING that may be reworded. One GET buys a stable code.
        if ! _api_raw GET "/api/agents"; then
            echo "Error: transport/server unreachable" >&2; exit 3
        fi
        if [ "$API_CODE" = "401" ] || [ "$API_CODE" = "403" ]; then
            echo "Error: auth missing/invalid (AID_AUTH)" >&2; exit 7
        fi
        if [ "$API_CODE" -ge 400 ]; then
            echo "Error: registry unavailable (HTTP ${API_CODE})" >&2; exit 3
        fi
        if ! printf '%s' "$API_OUT" | jq -e --arg id "$recipient_id"             '(.agents // [])[] | select(.id == $id)' >/dev/null; then
            echo "Error: recipient not found — no registered agent has id ${recipient_id}" >&2
            exit 4
        fi
    fi

    local payload
    payload="$(jq -n --arg to "$recipient_id" --arg s "$subject" --arg b "$body" \
        --arg p "$priority" --arg r "$reply_to" --arg f "$from" --arg t "$mtype" '
        {to: $to, subject: $s, content: {type: $t, message: $b}, priority: $p}
        + (if $r != "" then {replyTo: $r} else {} end)
        + (if $f != "" then {from: $f} else {} end)')"

    if ! _api_raw POST "/api/messages" "$payload"; then
        echo "Error: transport/server unreachable" >&2
        exit 3
    fi
    local err
    err="$(printf '%s' "$API_OUT" | jq -r '.error // .message // empty' 2>/dev/null || true)"
    case "$API_CODE" in
        2*)
            local mid
            mid="$(printf '%s' "$API_OUT" | jq -r '.messageId // .id // .message.id // empty' 2>/dev/null)"
            if [ -n "$mid" ]; then printf '%s\n' "$mid"; else printf '%s\n' "$API_OUT"; fi
            exit 0 ;;
        401) echo "Error: auth missing/invalid (AID_AUTH)${err:+ — ${err}}" >&2; exit 7 ;;
        403)
            # The R6 gate's refusal carries the routing hint — verbatim, that IS
            # the contract: the caller follows it, never retries around it.
            echo "R6 REFUSED${err:+: ${err}}" >&2; exit 6 ;;
        404) echo "Error: recipient not found${err:+ — ${err}}" >&2; exit 4 ;;
        *)   echo "Error: HTTP ${API_CODE}${err:+ — ${err}}" >&2; exit 1 ;;
    esac
}

show_help() {
    sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

case "${1:-help}" in
    send)    shift; cmd_send "$@" ;;
    resolve) shift; cmd_resolve "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-message.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; show_help >&2; exit 2 ;;
esac
