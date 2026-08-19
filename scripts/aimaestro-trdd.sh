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
#   aimaestro-trdd.sh approve <trdd-id> [--approver W] [--rationale R] [--agent A]
#   aimaestro-trdd.sh refuse  <trdd-id> [--approver W] --reason R      [--agent A]
#       --reason is REQUIRED for refuse (ai-maestro#71): it must name the defect, not the
#       verdict. A bare "denied" is rejected. `approve` keeps it optional.
#       --tier is DEPRECATED on both verbs and is NOT sent (ai-maestro#69): the approval
#       requirement is read from the card's own `min-approval-requirement:`, never from
#       the approver. Still accepted so existing calls keep working.
#   aimaestro-trdd.sh verify  <trdd-id>
#       Is this card's approval REAL? Exit 0 verified · non-zero otherwise (the gate
#       consumers rely on; governance-spec R41.enf-verify pins the non-zero contract).
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
      --approver W --rationale R
  refuse <trdd-id> --reason R    proposal → refused, git mv → refused/
                                 --reason REQUIRED and must name the defect (ai-maestro#71)
      --approver W --reason R
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

Deprecated:
  --tier                         Still accepted on approve/refuse, but IGNORED and NOT
                                 sent — the server retired it. The approval requirement
                                 is the CARD's, not the approver's: it is read from its
                                 own `min-approval-requirement:`, whose ladder is
                                 none < orchestrator < chief-of-staff < manager < user.
                                 Set it with:
                                   aimaestro-trdd.sh edit <id> --set min-approval-requirement=<name>

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
#
# NOTE — this numbering is INVERTED against the rest of the project, and it is a
# grandfathered EXCEPTION, not a second convention. Every pillar CLI (greptrdd,
# trdd-doctor, pillars-lint) uses grep's trichotomy: 0 clean, 1 = FINDINGS (the
# substantive negative answer), 2 = THE CHECK COULD NOT RUN. Here 2 and 1 mean the
# opposite. The `||` above is right for THIS verb only, because both non-zero codes
# mean "do not proceed" — copy it onto `greptrdd validate` and you silently turn
# could-not-run into found-findings. Kept as-is because this is the external
# boundary plugins call and a consumer branching on `[ $? -eq 2 ]` lives in a repo
# we cannot audit; governance-spec R41.enf-verify pins only "exits non-zero", so
# the spec would permit renumbering but the unauditable consumers do not.
# Documented in docs/SCRIPT-LAYER.md; decided in TRDD-8KDIB2LT.
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
    # --tier IS A DEAD FLAG. Kept accepted, and made honest (ai-maestro#69 item 2).
    #
    # THREE defects met on this one flag. (a) The server RETIRED the numeric tier body field
    # (ai-maestro#66 Q9): `approve/route.ts` reads only {approver, rationale, agentId} and
    # `refuse/route.ts` only {approver, reason, agentId} — neither has EVER read `tier`. So the
    # value was serialised into a body that silently dropped it and the caller got a success,
    # believing they had set the approval requirement. (b) The validator demanded a NUMBER, so
    # the five canonical ladder NAMES — which docs/SCRIPT-MANIFEST.md publishes in this very
    # section — were rejected outright, and the error taught the wrong vocabulary to exactly the
    # reader who had just read the ladder. (c) It accepted any number, so `--tier 9` passed.
    #
    # NOT FIXED BY WIRING IT UP. The requirement is the CARD's property, decided by the D3
    # objective floor; letting the approver pass it would let them lower the bar they must
    # clear — a governance hole, not a convenience. So the honest fix is to refuse to pretend.
    #
    # KEPT ACCEPTED rather than deleted because the skill-facing CLI is frozen (R23): every
    # previously-valid call still works, with identical stdout and exit code and one added
    # stderr line. What DOES now fail is an unmatchable value, on the ai-maestro#114 precedent
    # — a value that silently does nothing is indistinguishable from one that worked.
    if [ -n "$tier" ]; then
        local tier_norm="" tier_extra=""
        case "$tier" in
            none|orchestrator|chief-of-staff|manager|user) tier_norm="$tier" ;;
            0) tier_norm="none" ;;
            2) tier_norm="manager" ;;
            3) tier_norm="user" ;;
            # The legacy numeric ladder cannot express this rung: tier 1 is chief-of-staff
            # OR orchestrator depending on whether the scope is dispatch-only. That
            # ambiguity is itself a reason the numeric form is retired.
            1) tier_norm="chief-of-staff"
               tier_extra="      (legacy '1' is AMBIGUOUS — it means 'orchestrator' when the scope is dispatch-only)" ;;
            *)
                echo "Error: invalid --tier '${tier}'." >&2
                echo "       The ladder is: none < orchestrator < chief-of-staff < manager < user" >&2
                echo "       (retired numeric form: 0=none, 1=chief-of-staff|orchestrator, 2=manager, 3=user)" >&2
                return 1 ;;
        esac
        echo "Note: --tier is DEPRECATED and is NOT sent to the server (ai-maestro#69)." >&2
        echo "      The approval requirement is read from the card's own 'min-approval-requirement:'," >&2
        echo "      never from the approver. You named '${tier_norm}'; to set it on the card:" >&2
        [ -n "$tier_extra" ] && echo "$tier_extra" >&2
        echo "      aimaestro-trdd.sh edit ${id} --set min-approval-requirement=${tier_norm}" >&2
    fi

    # A REFUSAL MUST NAME ITS DEFECT (ai-maestro#71 — the USER-ratified refusal protocol,
    # `rules/aimaestro/aimaestro-trdd-approval.md` "an approver is a GUIDE, not a GATE").
    #
    # `approve` is deliberately exempt: an approval that says nothing is merely terse. A refusal
    # that says nothing is malpractice EVEN WHEN THE RULING IS CORRECT, because the proposer
    # cannot read the approver's mind — it hears "no", concludes the capability is forbidden, and
    # tears out the work that depended on it. That is not hypothetical: it is the incident the
    # protocol was ratified from, where a correct security denial led a plugin Claude to start
    # deleting its own working skills.
    #
    # The bar is a proxy, not a judge — no check can tell a real defect from a fluent
    # non-answer. What it CAN do is make the cheapest failure impossible: the one-word "denied"
    # that ends the thread. So it rejects an empty reason and the stock dismissals, and the error
    # TEACHES the three required elements, because the remedy is the refuser writing them.
    if [ "$verb" = "refuse" ]; then
        local reason_trimmed
        reason_trimmed="$(printf '%s' "$reason" | tr -d '[:space:]')"
        local stock='^(no|nope|denied|deny|rejected|reject|refused|refuse|wontfix|invalid|na|n/a|notnow|later|unclear|insufficient|insecure|toorisky|outofscope)[.!]?$'
        if [ -z "$reason_trimmed" ]; then
            cat >&2 <<'MSG'
Error: refuse requires --reason.

  A refusal is the START of the work on a proposal, not the end. Per the ratified
  approval protocol (ai-maestro#71), every refusal must carry all three:

    1. THE PRECISE DEFECT   the exact command / input path / abuse / rule.
                            "insufficiently secure" is not a finding;
                            "--exec takes an unsanitized string a malicious agent
                            can pass to a shell" is.
    2. THE BAR             what would make it approvable.
    3. THE INVITATION      say re-proposal is welcome — and when the design cannot
                            be saved, push toward the goal by another route.
                            Refuse the implementation; never refuse the need.

  If you cannot name the defect, you do not yet understand your own objection
  well enough to have refused.
MSG
            return 1
        fi
        if printf '%s' "${reason_trimmed}" | tr '[:upper:]' '[:lower:]' | grep -Eq "$stock"; then
            echo "Error: --reason \"${reason}\" names no defect — it is a verdict, not a finding." >&2
            echo "       State WHAT is wrong, WHAT would fix it, and that a re-proposal is welcome (ai-maestro#71)." >&2
            return 1
        fi
    fi

    # `tier` is deliberately ABSENT from this body — see the --tier block above. Both routes
    # discard it, so sending it is the silent lie the fix removes. (It could not have carried a
    # name either: the old `$t | tonumber` would have died on one.)
    local body
    body="$(jq -nc --arg ap "$approver" --arg r "$reason" \
        --arg rk "$reason_key" --arg a "$agent" '
        {}
        + (if $ap != "" then {approver: $ap} else {} end)
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
