#!/usr/bin/env bash
# =============================================================================
# AI Maestro Statusline Feed CLI          (TRDD-D8OYFG35)
# =============================================================================
#
# THE ONLY THING IN THE ECOSYSTEM THAT KNOWS THE STATUSLINE ENDPOINTS.
#
# Per the decoupling invariant, no plugin, hook, skill or agent may curl the AI
# Maestro API directly — the API changes constantly and plugins must not. This
# script is the immutable CLI in front of it: new capability = new subcommand or
# new optional flag, never a changed contract.
#
#   aimaestro-statusline.sh ingest [--file PATH]
#       Send ONE Claude Code statusline payload (JSON on stdin, or from PATH).
#       This is what `aimaestro-statusline-capture.sh` forks, detached.
#
#   aimaestro-statusline.sh get <sessionId>
#       The last observation stored for that session, plus its age.
#
#   aimaestro-statusline.sh list
#       The fleet roll-up: the TIGHTEST 5h/7d window across live sessions.
#
# WHY AN AGENT WANTS THIS: the 5-hour and 7-day rate-limit windows arrive in the
# statusline payload at ZERO API cost. `get`/`list` hand them back without any
# agent having to spend a call on /api/oauth/usage. (The model-scoped weekly
# windows, `severity` and `is_active` are NOT in this feed and remain
# endpoint-only — do not expect them here.)
#
# Auth: `get`/`list` are ordinary fleet reads — agent callers export AID_AUTH,
# the human uses the dashboard session cookie (both resolved by get_auth_args).
# `ingest` needs NO credential: the route is console-only, and Claude Code runs
# the user's statusline in a plain terminal with neither a cookie nor a token.
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

DEFAULT_PORT=23000

# ---------------------------------------------------------------------------
# _seed_loopback_base
#
# Pre-seeds AIMAESTRO_API_BASE — which get_api_base honours FIRST — so the
# ingest path never pays for host discovery.
#
# WHY THIS EXISTS: get_api_base falls back to get_self_host_url, which curls
# /api/hosts/identity with a 5-second timeout. `ingest` runs on Claude Code's
# statusline cadence (debounced at 300ms, refreshInterval as low as 1s), so that
# lookup would be a network round-trip every few seconds forever — and a FIVE
# SECOND stall on every single one whenever the server is down. The lookup buys
# nothing here either: the ingest route is console-only, so its base is loopback
# by construction and only the PORT is ever in question.
#
# This is a pre-seed, not a second resolver: everything still flows through the
# one get_api_base entry point, via its own documented override.
# ---------------------------------------------------------------------------
_seed_loopback_base() {
    [ -n "${AIMAESTRO_API_BASE:-}" ] && return 0

    local port="${AIMAESTRO_PORT:-}"
    if [ -z "$port" ] && [ -f "${HOME}/.aimaestro/hosts.json" ] && command -v jq >/dev/null 2>&1; then
        local url
        url="$(jq -r '.hosts[]? | select(.type == "local") | .url' "${HOME}/.aimaestro/hosts.json" 2>/dev/null | head -1)"
        # STRIP THE SCHEME FIRST. `${url%%/*}` alone cuts at the FIRST slash, which in
        # `http://127.0.0.1:23000` is the one in `://` — yielding `http:`, whose `##*:`
        # is the EMPTY string. The port then silently fell back to the default, so a
        # host on a non-standard port would have been ingested into the wrong server
        # (or nothing) with no error anywhere. Order matters: scheme, then path, then port.
        url="${url#*://}"       # http://host:port/path -> host:port/path
        url="${url%%/*}"        # host:port/path        -> host:port
        local maybe="${url##*:}"
        case "$maybe" in
            ''|*[!0-9]*) : ;;   # no port in the URL, or not numeric — keep the default
            *) port="$maybe" ;;
        esac
    fi
    case "$port" in
        ''|*[!0-9]*) port="$DEFAULT_PORT" ;;
    esac

    AIMAESTRO_API_BASE="http://127.0.0.1:${port}"
    export AIMAESTRO_API_BASE
}

# ---------------------------------------------------------------------------
# _read_api METHOD PATH  — a GET that authenticates and reports HTTP errors.
# Fail-closed on a missing/unparseable status line, matching the contract of
# aimaestro-session.sh::_api (an empty body must never flow downstream as 2xx).
# ---------------------------------------------------------------------------
_read_api() {
    local method="$1" path="$2"
    local base
    base="$(get_api_base)"
    local -a auth_args=()
    get_auth_args auth_args

    local resp code out
    resp="$(curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
        "${auth_args[@]}" "${base}${path}")" || {
        echo "Error: request to ${path} failed (network)" >&2; return 1; }

    code="$(printf '%s' "$resp" | tail -n1)"
    out="$(printf '%s' "$resp" | sed '$d')"

    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from ${path} (no HTTP status code)" >&2
        return 1
    fi
    if [ "$code" -ge 400 ]; then
        local err=""
        if command -v jq >/dev/null 2>&1; then
            err="$(printf '%s' "$out" | jq -r '.error // .message // empty' 2>/dev/null)"
        fi
        echo "Error: HTTP ${code}${err:+ — ${err}}" >&2
        if [ "$code" = "401" ] || [ "$code" = "403" ]; then
            echo "Hint: reads need AID_AUTH (agent) or a dashboard session (human)." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}

cmd_ingest() {
    local file=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --file) file="${2:-}"; shift 2 ;;
            -h|--help) echo "Usage: aimaestro-statusline.sh ingest [--file PATH]"; return 0 ;;
            *) echo "Error: unknown option for ingest: $1" >&2; return 1 ;;
        esac
    done

    _seed_loopback_base
    local base
    base="$(get_api_base)"

    # --data-binary, never -d: -d strips newlines and would silently mutate a
    # payload we are supposed to relay verbatim. `@-` and `@FILE` both stream, so
    # a large payload is never materialised in an argv or a shell variable.
    local src="@-"
    if [ -n "$file" ]; then
        [ -f "$file" ] || { echo "Error: no such file: $file" >&2; return 1; }
        src="@${file}"
    fi

    # --max-time 10: this runs on the statusline cadence. Nobody waits on it (the
    # wrapper forks it detached), but an unbounded curl against a wedged server
    # would leave one process per tick alive forever.
    local resp code out
    resp="$(curl -s -w $'\n%{http_code}' --max-time 10 -X POST \
        -H "Content-Type: application/json" --data-binary "$src" \
        "${base}/api/statusline/ingest")" || {
        echo "Error: statusline ingest failed (network)" >&2; return 1; }

    code="$(printf '%s' "$resp" | tail -n1)"
    out="$(printf '%s' "$resp" | sed '$d')"

    if ! [[ "$code" =~ ^[0-9]+$ ]]; then
        echo "Error: malformed response from /api/statusline/ingest" >&2
        return 1
    fi
    if [ "$code" -ge 400 ]; then
        echo "Error: HTTP ${code} from /api/statusline/ingest" >&2
        printf '%s\n' "$out" >&2
        return 1
    fi
    printf '%s\n' "$out"
}

cmd_get() {
    local sid="${1:-}"
    [ -z "$sid" ] && { echo "Error: sessionId required" >&2; return 1; }
    # Validated here as well as server-side: this value is interpolated into a
    # URL path, and a shell that hands `../..` to curl is a shell that made the
    # server's own guard the only thing standing in the way.
    if [[ ! "$sid" =~ ^[A-Za-z0-9_-]{1,128}$ ]]; then
        echo "Error: invalid sessionId '${sid}' (expected [A-Za-z0-9_-]{1,128})" >&2
        return 1
    fi
    _read_api GET "/api/statusline/${sid}"
}

cmd_list() {
    _read_api GET "/api/statusline"
}

usage() {
    sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
    ingest) shift; cmd_ingest "$@" ;;
    get)    shift; cmd_get "$@" ;;
    list)   shift; cmd_list "$@" ;;
    -h|--help|help|"") usage ;;
    *) echo "Error: unknown command '$1'" >&2; usage >&2; exit 1 ;;
esac
