#!/usr/bin/env bash
# =============================================================================
# _resolve_agent_id() tests — TRDD-17K0SHDQ (shared resolver in common.sh)
# =============================================================================
# `_resolve_agent_id` used to be pasted byte-identical into aimaestro-panel.sh,
# aimaestro-session.sh, and aimaestro-continuity.sh, and its multi-match branch
# was `jq -r '.agents[0].id // empty'` — SILENT FIRST-MATCH-WINS over an
# UNSORTED substring search (`GET /api/agents?q=<ref>`). A ref that happened
# to match more than one agent resolved to whichever agent the server listed
# first, with no warning. This drives the now-shared definition in
# scripts/shell-helpers/common.sh by sourcing it and overriding `curl` as a
# shell function that returns canned JSON — no network, no mocking framework.
#
# NEUTER RUN (recorded, not left applied — see the bottom of this file):
# reverting the N-match branch to `agents[0]` behavior (the old bug) reddens
# case (d) only when the exact match is NOT first in the canned list, and
# reddens case (e) and case (f) unconditionally (both would have silently
# picked agents[0] instead of refusing). Case (d) with the exact match
# ALREADY first is a false negative for that neuter shape by construction —
# which is why case (d)'s fixture below deliberately lists the exact-name
# match SECOND.
#
# Run:  bash tests/shell/aimaestro-resolve-agent-id.test.sh
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="${SCRIPT_DIR}/../../scripts/shell-helpers/common.sh"

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
declare -a ROW_NAME=() ROW_STATUS=() ROW_DESC=()

record() {
    local name="$1" rc="$2" desc="$3"
    ROW_NAME+=("$name"); ROW_DESC+=("$desc")
    if [ "$rc" = "0" ]; then
        ROW_STATUS+=("PASS"); PASS_COUNT=$((PASS_COUNT + 1))
    else
        ROW_STATUS+=("FAIL"); FAIL_COUNT=$((FAIL_COUNT + 1))
        printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$name" >&2
    fi
}

# --- environment: isolate from the real machine, skip host-identity network -
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
# get_api_base() returns this verbatim when set — skips _init_self_host's own
# curl call entirely, so our fake curl below is exercised ONLY by the code
# under test, never by unrelated host-identity resolution.
export AIMAESTRO_API_BASE="http://test.invalid:23000"
unset AID_AUTH AIMAESTRO_SESSION AIMAESTRO_SUDO_TOKEN

# shellcheck disable=SC1090
source "$COMMON"

command -v jq >/dev/null 2>&1 || { echo "${RED}jq is required${RESET}" >&2; exit 2; }

# The fake network layer: curl is a SHELL FUNCTION (bash resolves it ahead of
# any curl on PATH), so _resolve_agent_id's `curl -s --max-time 30 ... "$url"`
# never leaves this process. It ignores its arguments and returns whatever the
# test just put in $CURL_CANNED_JSON — the one seam _resolve_agent_id has.
curl() {
    printf '%s' "$CURL_CANNED_JSON"
}

# run <ref> — calls the function under test, capturing stdout/stderr/rc.
run() {
    local ref="$1"
    R_OUT="$(_resolve_agent_id "$ref" 2>"$TMP_HOME/stderr")"
    R_RC=$?
    R_ERR="$(cat "$TMP_HOME/stderr")"
}

# ============================================================================
# (a) UUID passthrough — never queries the network.
# ============================================================================
t_a_uuid_passthrough() {
    CURL_CANNED_JSON='THIS MUST NEVER BE READ'
    run "11111111-2222-3333-4444-555555555555"
    [ "$R_RC" = "0" ] && [ "$R_OUT" = "11111111-2222-3333-4444-555555555555" ]
    record "uuid_passthrough" "$?" "a UUID-shaped ref is echoed verbatim, no query"
}

# ============================================================================
# (b) 0 matches -> refuse.
# ============================================================================
t_b_zero_matches() {
    CURL_CANNED_JSON='{"agents":[]}'
    run "nobody"
    [ "$R_RC" != "0" ] && [ -z "$R_OUT" ] \
        && printf '%s' "$R_ERR" | grep -q "agent not found: nobody"
    record "zero_matches_refuses" "$?" "0 matches -> stderr 'agent not found', exit 1"
}

# ============================================================================
# (c) exactly 1 match -> its id.
# ============================================================================
t_c_single_match() {
    CURL_CANNED_JSON='{"agents":[{"id":"aaaaaaaa-0000-0000-0000-000000000001","name":"alice"}]}'
    run "alice"
    [ "$R_RC" = "0" ] && [ "$R_OUT" = "aaaaaaaa-0000-0000-0000-000000000001" ]
    record "single_match_resolves" "$?" "exactly 1 match -> that agent's id"
}

# ============================================================================
# (d) N matches, exactly one has the EXACT ref as its name -> that one's id.
# The exact match is listed SECOND on purpose (see the neuter note at top):
# a first-match-wins bug would return the FIRST entry's id here, which is a
# different uuid, so this case discriminates the fix from the old bug.
# ============================================================================
t_d_unique_exact_name() {
    CURL_CANNED_JSON='{"agents":[
        {"id":"bbbbbbbb-0000-0000-0000-000000000002","name":"bob-2"},
        {"id":"bbbbbbbb-0000-0000-0000-000000000001","name":"bob"}
    ]}'
    run "bob"
    [ "$R_RC" = "0" ] && [ "$R_OUT" = "bbbbbbbb-0000-0000-0000-000000000001" ]
    record "unique_exact_name_wins" "$?" \
        "N matches, one exact-name hit (not first) -> that agent, not agents[0]"
}

# ============================================================================
# (e) N matches, NO exact-name hit -> hard fail, names only, NEVER a uuid.
# ============================================================================
t_e_no_unique_exact_hard_fails() {
    CURL_CANNED_JSON='{"agents":[
        {"id":"cccccccc-0000-0000-0000-000000000001","name":"bob-1"},
        {"id":"cccccccc-0000-0000-0000-000000000002","name":"bob-2"}
    ]}'
    run "bob"
    [ "$R_RC" != "0" ] && [ -z "$R_OUT" ] \
        && printf '%s' "$R_ERR" | grep -q "ambiguous agent ref 'bob'" \
        && printf '%s' "$R_ERR" | grep -q "bob-1" \
        && printf '%s' "$R_ERR" | grep -q "bob-2"
    record "no_exact_hit_hard_fails" "$?" \
        "N matches, no exact-name hit -> refuse, error lists both candidate names"

    # Positive control for the anti-impersonation contract: the error text
    # must carry the two agent NAMES and must NEVER carry a uuid-shaped token.
    ! printf '%s' "$R_ERR" | grep -qE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    record "ambiguous_error_leaks_no_uuid" "$?" \
        "ambiguous-ref error names candidates by NAME only, never their uuid"
}

# ============================================================================
# (f) N matches, two names differ only by case, ref matches BOTH
# case-insensitively -> no UNIQUE hit -> hard fail (never guess between them).
# ============================================================================
t_f_case_insensitive_ambiguous() {
    CURL_CANNED_JSON='{"agents":[
        {"id":"dddddddd-0000-0000-0000-000000000001","name":"Bob"},
        {"id":"dddddddd-0000-0000-0000-000000000002","name":"BOB"}
    ]}'
    run "bob"
    [ "$R_RC" != "0" ] && [ -z "$R_OUT" ] \
        && printf '%s' "$R_ERR" | grep -q "ambiguous agent ref 'bob'"
    record "case_insensitive_ambiguous_hard_fails" "$?" \
        "two names differ only by case, ref matches both ci -> refuse (no unique hit)"
}

# ============================================================================
# (g) `self` / `<self>` -> the whoami route's id, verbatim (TRDD-COOLOZ1N
# ruling 2). The canned body is the /api/agents/me shape ({id,name}), which has
# NO .agents array — so this also proves the self branch takes the whoami path:
# fed to the ?q= parser it would count 0 matches and refuse.
# ============================================================================
t_g_self_resolves_via_whoami() {
    CURL_CANNED_JSON='{"id":"eeeeeeee-0000-0000-0000-000000000001","name":"myself"}'
    run "self"
    local ok1=$?
    [ "$R_RC" = "0" ] && [ "$R_OUT" = "eeeeeeee-0000-0000-0000-000000000001" ]
    ok1=$?
    run "<self>"
    [ "$ok1" = "0" ] && [ "$R_RC" = "0" ] && [ "$R_OUT" = "eeeeeeee-0000-0000-0000-000000000001" ]
    record "self_resolves_via_whoami" "$?" \
        "self and <self> -> the whoami id (the {id,name} shape proves the me path, not ?q=)"
}

# ============================================================================
# (h) `self` without an agent credential -> the route's no_self_agent error is
# surfaced with the remedy named, exit 1 — never a silent empty id.
# ============================================================================
t_h_self_without_aid_refuses() {
    CURL_CANNED_JSON='{"error":"no_self_agent","message":"me is for agent callers (AID_AUTH)."}'
    run "self"
    [ "$R_RC" != "0" ] && [ -z "$R_OUT" ] \
        && printf '%s' "$R_ERR" | grep -q "could not resolve self" \
        && printf '%s' "$R_ERR" | grep -q "AID_AUTH"
    record "self_without_aid_refuses" "$?" \
        "whoami error body -> refuse, error names no_self_agent + the AID_AUTH remedy"
}

# --- run all -----------------------------------------------------------------
t_a_uuid_passthrough
t_b_zero_matches
t_c_single_match
t_d_unique_exact_name
t_e_no_unique_exact_hard_fails
t_f_case_insensitive_ambiguous
t_g_self_resolves_via_whoami
t_h_self_without_aid_refuses

# --- results table (unicode-bordered, colorized) ----------------------------
NAME_W=32; STAT_W=6; DESC_W=64
repeat() {
    local s="$1" n="$2" out=""
    while [ "$n" -gt 0 ]; do out+="$s"; n=$((n - 1)); done
    printf '%s' "$out"
}
line() {
    printf '%s%s%s%s%s%s%s\n' \
        "$1" "$(repeat "$4" $((NAME_W + 2)))" \
        "$2" "$(repeat "$4" $((STAT_W + 2)))" \
        "$2" "$(repeat "$4" $((DESC_W + 2)))" "$3"
}
echo
line '┏' '┳' '┓' '━'
printf '┃ %s%-*s%s ┃ %s%-*s%s ┃ %s%-*s%s ┃\n' \
    "$BOLD" "$NAME_W" "Test" "$RESET" "$BOLD" "$STAT_W" "Status" "$RESET" "$BOLD" "$DESC_W" "Description" "$RESET"
line '┡' '╇' '┩' '━'
for i in "${!ROW_NAME[@]}"; do
    st="${ROW_STATUS[$i]}"; col="$GREEN"; [ "$st" = "FAIL" ] && col="$RED"
    printf '│ %-*s │ %s%-*s%s │ %s%-*.*s%s │\n' \
        "$NAME_W" "${ROW_NAME[$i]}" \
        "$col" "$STAT_W" "$st" "$RESET" \
        "$DIM" "$DESC_W" "$DESC_W" "${ROW_DESC[$i]}" "$RESET"
done
line '└' '┴' '┘' '─'
echo
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [ "$FAIL_COUNT" -eq 0 ]; then
    printf '%s%d/%d passed. All green.%s\n' "$GREEN" "$PASS_COUNT" "$TOTAL" "$RESET"
    exit 0
else
    printf '%s%d/%d passed, %d FAILED.%s\n' "$RED" "$PASS_COUNT" "$TOTAL" "$FAIL_COUNT" "$RESET"
    exit 1
fi
