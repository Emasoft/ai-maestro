#!/usr/bin/env bash
# =============================================================================
# AMP identity-resolution tests — TRDD-979dbdaa / issue #46
# =============================================================================
# Exercises the layered AMP identity resolver in scripts/amp-helper.sh by
# sourcing the REAL helper inside clean `env -i` subprocesses (no mocking) and
# asserting the resolved $AMP_DIR / exit code / stderr for each layer:
#
#   P1  AMP_DIR (explicit)                    P2   CLAUDE_AGENT_ID (--id)
#   P2.5 AIM_AGENT_ID / AIM_AGENT_NAME (env)  P3   CLAUDE_AGENT_NAME / tmux
#   P3.5 CWD (~/agents/<name>) fallback       P4   single-agent / multi error
#
# Load-bearing cases:
#   * REGRESSION (mandated by the TRDD): ~/agents ABSENT + exactly 1 indexed
#     agent MUST still resolve via P4 — proves the P3.5 addition does not trip
#     `set -euo pipefail` and kill the script before P4.
#   * P2.5 env-first resolution when AMP_DIR was scrubbed.
#   * P3.5 anti-spoofing: CWD-derived name must agree with a present
#     AIM_AGENT_NAME, else REFUSE (never silently trust the directory).
#
# Run:  bash tests/amp-identity-resolution.test.sh
# Not a vitest file (.sh, not .test.ts) — the resolver is pure bash.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${SCRIPT_DIR}/../scripts/amp-helper.sh"
SAVED_PATH="$PATH"
P_ERRFILE="$(mktemp)"
declare -a CLEANUP_DIRS=()

trap 'rm -f "$P_ERRFILE"; for d in "${CLEANUP_DIRS[@]}"; do rm -rf "$d"; done' EXIT

RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
declare -a ROW_NAME=() ROW_STATUS=() ROW_DESC=()

# --- fixtures ---------------------------------------------------------------
new_home() {
    local h; h="$(mktemp -d)"
    CLEANUP_DIRS+=("$h")
    mkdir -p "$h/.agent-messaging/agents"
    printf '{}' > "$h/.agent-messaging/agents/.index.json"
    printf '%s' "$h"
}

# add_agent <home> <name> <uuid> — register a name→uuid entry in .index.json
add_agent() {
    local home="$1" name="$2" uuid="$3"
    local idx="$home/.agent-messaging/agents/.index.json"
    jq --arg n "$name" --arg u "$uuid" '.[$n] = $u' "$idx" > "$idx.tmp" && mv "$idx.tmp" "$idx"
}

# add_workdir <home> <name> — create the ~/agents/<name>/ session workdir
add_workdir() {
    mkdir -p "$1/agents/$2"
}

# --- probe: run the REAL helper in a clean env, capture AMP_DIR/rc/stderr ----
# run_probe <home> <cwd> [ENV=val ...]
run_probe() {
    local home="$1" cwd="$2"; shift 2
    : > "$P_ERRFILE"
    P_OUT="$(env -i PATH="$SAVED_PATH" HOME="$home" CWD="$cwd" AMP_HELPER="$HELPER" "$@" \
        bash -c 'if [ -n "$CWD" ]; then cd "$CWD" || exit 97; fi; source "$AMP_HELPER"; printf "%s" "${AMP_DIR:-}"' \
        2>"$P_ERRFILE")"
    P_RC=$?
    P_ERR="$(cat "$P_ERRFILE")"
}

# --- assertion recorder -----------------------------------------------------
# rc is a SHELL exit status captured via "$?": 0 = the assertion compound
# succeeded (PASS), non-zero = it failed. (Do NOT flip this — bash truth is
# 0-is-success, which is the opposite of a 1-is-true boolean.)
record() {
    local name="$1" rc="$2" desc="$3"
    ROW_NAME+=("$name"); ROW_DESC+=("$desc")
    if [ "$rc" = "0" ]; then
        ROW_STATUS+=("PASS"); PASS_COUNT=$((PASS_COUNT + 1))
    else
        ROW_STATUS+=("FAIL"); FAIL_COUNT=$((FAIL_COUNT + 1))
        printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$name" >&2
        printf '       rc=%s out=%q\n' "$P_RC" "$P_OUT" >&2
        printf '       err=%s\n' "$(printf '%s' "$P_ERR" | head -3 | tr '\n' '|')" >&2
    fi
}

# ============================================================================
# TEST 1 — REGRESSION (TRDD-mandated): ~/agents ABSENT + exactly 1 indexed
#          agent still resolves via P4 (catches a `set -e` crash from P3.5).
# ============================================================================
t1_p4_single_no_agents_dir() {
    local h; h="$(new_home)"
    add_agent "$h" "solo" "11111111-1111-1111-1111-111111111111"
    # NOTE: deliberately do NOT create $h/agents — this is the crash trigger.
    run_probe "$h" "$h"
    local want="$h/.agent-messaging/agents/11111111-1111-1111-1111-111111111111"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$want" ]
    record "p4_single_agent_no_agents_dir" "$?" \
        "~/agents ABSENT + 1 indexed agent -> resolves via P4 (no set -e crash)"
}

# ============================================================================
# TEST 2 — P2.5: server-injected AIM_AGENT_ID resolves when AMP_DIR is scrubbed,
#          even with MANY indexed agents (would otherwise hit the P4 multi-error).
# ============================================================================
t2_p25_aim_agent_id() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    add_agent "$h" "beta"  "bbbbbbbb-0000-0000-0000-000000000002"
    add_agent "$h" "gamma" "cccccccc-0000-0000-0000-000000000003"
    run_probe "$h" "$h" AIM_AGENT_ID="bbbbbbbb-0000-0000-0000-000000000002"
    local want="$h/.agent-messaging/agents/bbbbbbbb-0000-0000-0000-000000000002"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$want" ]
    record "p25_aim_agent_id_no_amp_dir" "$?" \
        "AIM_AGENT_ID set, no AMP_DIR, many agents -> resolves via injected id"
}

# ============================================================================
# TEST 3 — P2.5: AIM_AGENT_NAME resolves via index lookup (env-first name path).
# ============================================================================
t3_p25_aim_agent_name() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    add_agent "$h" "beta"  "bbbbbbbb-0000-0000-0000-000000000002"
    run_probe "$h" "$h" AIM_AGENT_NAME="alpha"
    local want="$h/.agent-messaging/agents/aaaaaaaa-0000-0000-0000-000000000001"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$want" ]
    record "p25_aim_agent_name_lookup" "$?" \
        "AIM_AGENT_NAME set (in index), no AMP_DIR -> resolves via index lookup"
}

# ============================================================================
# TEST 4 — P3.5: fully env-scrubbed session resolves from CWD (~/agents/<name>),
#          and emits the auditable stderr note.
# ============================================================================
t4_p35_cwd_scrubbed() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    add_agent "$h" "beta"  "bbbbbbbb-0000-0000-0000-000000000002"
    add_workdir "$h" "beta"
    run_probe "$h" "$h/agents/beta"   # no env vars at all — genuine scrub
    local want="$h/.agent-messaging/agents/bbbbbbbb-0000-0000-0000-000000000002"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$want" ] \
        && printf '%s' "$P_ERR" | grep -q "derived from working directory"
    record "p35_cwd_scrubbed_resolves" "$?" \
        "env scrubbed, CWD=~/agents/<name> -> resolves via CWD + audit note"
}

# ============================================================================
# TEST 5 — P3.5 anti-spoofing: a present AIM_AGENT_NAME that DISAGREES with the
#          CWD-derived name must REFUSE (never trust a mismatched directory).
# ============================================================================
t5_p35_cross_check_refuses() {
    local h; h="$(new_home)"
    add_agent "$h" "bob" "bbbbbbbb-0000-0000-0000-00000000b0b0"  # victim, in index
    # alice is NOT in the index, so P2.5 name-lookup fails and P3.5 runs.
    add_workdir "$h" "bob"
    run_probe "$h" "$h" AIM_AGENT_NAME="alice" AGENT_WORK_DIR="$h/agents/bob"
    [ "$P_RC" != "0" ] \
        && printf '%s' "$P_ERR" | grep -q "does not match injected AIM_AGENT_NAME"
    record "p35_cross_check_refuses_spoof" "$?" \
        "AIM_AGENT_NAME != CWD-derived name -> REFUSE (anti-spoofing)"
}

# ============================================================================
# TEST 6 — no-match falls through UNCHANGED: a CWD outside ~/agents (the owner /
#          core-app session) with many agents still hits the P4 multi-error.
# ============================================================================
t6_p35_no_match_falls_through() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    add_agent "$h" "beta"  "bbbbbbbb-0000-0000-0000-000000000002"
    add_workdir "$h" "alpha"   # ~/agents EXISTS, but CWD is elsewhere
    run_probe "$h" "/tmp"
    [ "$P_RC" != "0" ] && printf '%s' "$P_ERR" | grep -q "AMP identity could not be resolved"
    record "p35_no_match_falls_through_to_p4" "$?" \
        "CWD not under ~/agents, many agents -> unchanged P4 multi-agent refusal"

    # ai-maestro#46 — the P4 refusal must NEVER print a pickable uuid. It used to list
    # every agent's address+uuid and close with "Example: … --id <uuid-from-above>",
    # which handed a session that CANNOT prove its identity the means to run as a live
    # peer (sending mail / moving kanban cards under that agent's name). The fixture
    # agents above carry uuid-shaped ids, so a regression that re-lists them trips this.
    ! printf '%s' "$P_ERR" | grep -qE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
    record "p4_refusal_leaks_no_uuid" "$?" \
        "P4 refusal names no agent uuid (anti-impersonation, ai-maestro#46)"
}

# ============================================================================
# TEST 7 — precedence: explicit --id (CLAUDE_AGENT_ID) wins over AIM_AGENT_ID.
# ============================================================================
t7_explicit_id_wins() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    add_agent "$h" "beta"  "bbbbbbbb-0000-0000-0000-000000000002"
    run_probe "$h" "$h" \
        CLAUDE_AGENT_ID="aaaaaaaa-0000-0000-0000-000000000001" \
        AIM_AGENT_ID="bbbbbbbb-0000-0000-0000-000000000002"
    local want="$h/.agent-messaging/agents/aaaaaaaa-0000-0000-0000-000000000001"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$want" ]
    record "explicit_id_wins_over_aim" "$?" \
        "CLAUDE_AGENT_ID (--id) present -> wins over AIM_AGENT_ID (explicit > env)"
}

# ============================================================================
# TEST 8 — P1 sanity: an explicit AMP_DIR is used verbatim (no re-resolution).
# ============================================================================
t8_p1_amp_dir_wins() {
    local h; h="$(new_home)"
    add_agent "$h" "alpha" "aaaaaaaa-0000-0000-0000-000000000001"
    local explicit="$h/.agent-messaging/agents/explicit-dir"
    run_probe "$h" "$h" AMP_DIR="$explicit"
    [ "$P_RC" = "0" ] && [ "$P_OUT" = "$explicit" ]
    record "p1_explicit_amp_dir_wins" "$?" \
        "explicit AMP_DIR set -> used verbatim (P1, no re-resolution)"
}

# --- run all ---------------------------------------------------------------
command -v jq >/dev/null 2>&1 || { echo "${RED}jq is required${RESET}" >&2; exit 2; }

t1_p4_single_no_agents_dir
t2_p25_aim_agent_id
t3_p25_aim_agent_name
t4_p35_cwd_scrubbed
t5_p35_cross_check_refuses
t6_p35_no_match_falls_through
t7_explicit_id_wins
t8_p1_amp_dir_wins

# --- results table (unicode-bordered, colorized) ---------------------------
NAME_W=34; STAT_W=6; DESC_W=62
repeat() {  # repeat a (possibly multibyte) string $2 times — byte-safe, unlike `tr`
    local s="$1" n="$2" out=""
    while [ "$n" -gt 0 ]; do out+="$s"; n=$((n - 1)); done
    printf '%s' "$out"
}
line() {  # $1=left $2=mid $3=right $4=fill (fill may be multibyte)
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
