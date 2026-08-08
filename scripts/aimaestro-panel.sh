#!/usr/bin/env bash
# =============================================================================
# AI Maestro HTML Side-Panel CLI
# =============================================================================
#
# Stable command-line wrapper around the AI Maestro dashboard side-panel API.
# The skill-facing CLI here is IMMUTABLE, while the server API behind it may
# change freely — that contract is fact and holds regardless of callers.
# Visualizer plugins (visual-communicator, webdesign, …) are INTENDED to call
# this script, never the HTTP API directly. As of 2026-08-08 NEITHER plugin has
# wired it (zero callers in both repos, measured by the COS session — ai-maestro#132);
# the sentence above states the integration contract, not a shipped integration.
#
# Lets an agent push live HTML — or a live URL — into the human's dashboard side
# panel, open/close/refresh it remotely, and drain the click feedback the human
# generated inside it. That replaces "deploy to Vercel and paste the link" with
# "show it right here, get feedback back".
#
# Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
# `open`/`close`/`refresh`/`set` hit a strict-classified route (pushing HTML into
# the human's dashboard is the same trust level as injecting into a terminal), so
# a USER caller must supply AIMAESTRO_SUDO_TOKEN; an AGENT caller authorizes by
# AID + governance title (the R32 dual-path) and needs none.
#
# Usage:
#   aimaestro-panel.sh open <agent> [--url <https-url>]
#   aimaestro-panel.sh close <agent>
#   aimaestro-panel.sh refresh <agent>
#   aimaestro-panel.sh set <agent> --html-file <path> | --html "<html>" | --url <https-url>
#   aimaestro-panel.sh status <agent>
#   aimaestro-panel.sh feedback <agent>
#
# <agent> is an agent UUID, or a name/alias resolved via /api/agents?q=.
#
# NOTE ON `delivered`: the panel is a LIVE surface, not a queue. A response with
# "delivered": 0 means no dashboard currently has that agent's panel channel open
# — the message was dropped, NOT stored. Check `status` first if that matters.
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
        # --data-binary + @file would be nicer for a 2MB payload, but the body is
        # already a jq-built JSON string here; -d @- reads it from stdin so a
        # large HTML document never becomes a multi-megabyte argv entry (ARG_MAX).
        resp="$(printf '%s' "$body" | curl -s -w $'\n%{http_code}' --max-time 30 -X "$method" \
            "${auth_args[@]}" "${sudo_args[@]}" \
            -H "Content-Type: application/json" --data-binary @- "${base}${path}")" || {
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
            echo "Hint: strict routes need AIMAESTRO_SUDO_TOKEN (user) or AID_AUTH (agent)." >&2
        fi
        return 1
    fi
    printf '%s\n' "$out"
}

# _resolve_agent_id() is now shared — see scripts/shell-helpers/common.sh
# (TRDD-17K0SHDQ; was duplicated byte-identical across 3 scripts).

show_help() {
    cat <<'EOF'
aimaestro-panel.sh — AI Maestro dashboard HTML side-panel CLI

Commands:
  open <agent> [--url <https-url>]   Open the panel (optionally on a live URL)
  close <agent>                      Close the panel
  refresh <agent>                    Re-render whatever the panel currently holds
  set <agent> [content flag]         Replace the panel's content
      --html-file <path>             Read the HTML document from a file
      --html "<html>"                Inline HTML (small snippets only)
      --url <https-url>              Preview a live http(s) URL instead
  status <agent>                     Connected panel channels + pending feedback
  feedback <agent>                   Drain the click-feedback queue (read + clear)
  help

Content rules (enforced server-side):
  - html and url are mutually exclusive; `set` requires exactly one of them.
  - html is capped at 2 MB.
  - url must be http(s) — javascript:, file:, data: are rejected.

Strict routes (open, close, refresh, set) require AIMAESTRO_SUDO_TOKEN for USER
callers. Agent callers authorize by AID_AUTH + governance title.

Environment:
  AID_AUTH               Bearer token for agent callers (REQUIRED — no localhost exemption)
  AIMAESTRO_SUDO_TOKEN   X-Sudo-Token passthrough for strict routes
  AIMAESTRO_API_BASE     Override the API base URL (default: this host)
EOF
}

# Build the {action, html?, url?} body. `set` demands content; open may carry a
# url; close/refresh carry neither. The server re-validates all of this.
_panel_post() {
    local action="$1" ref="$2"; shift 2
    local html="" url="" html_file="" content_flags=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --html)      html="$2";      content_flags=$((content_flags + 1)); shift 2 ;;
            --html-file) html_file="$2"; content_flags=$((content_flags + 1)); shift 2 ;;
            --url)       url="$2";       content_flags=$((content_flags + 1)); shift 2 ;;
            *) echo "Error: unknown flag for '${action}': $1" >&2; return 1 ;;
        esac
    done

    if [ "$content_flags" -gt 1 ]; then
        echo "Error: --html, --html-file and --url are mutually exclusive" >&2
        return 1
    fi
    if [ "$action" = "set" ] && [ "$content_flags" -eq 0 ]; then
        echo "Error: 'set' requires one of --html-file <path>, --html \"<html>\", or --url <url>" >&2
        return 1
    fi
    if [ -n "$html_file" ]; then
        [ -f "$html_file" ] || { echo "Error: file not found: $html_file" >&2; return 1; }
        html="$(cat "$html_file")"
    fi

    local id body
    id="$(_resolve_agent_id "$ref")" || return 1
    # --rawfile would re-read the file; we already hold it in $html. jq --arg is
    # binary-safe for the UTF-8 text an HTML document is.
    body="$(jq -nc --arg a "$action" --arg h "$html" --arg u "$url" '
        {action: $a}
        + (if $h != "" then {html: $h} else {} end)
        + (if $u != "" then {url: $u} else {} end)')"
    _api POST "/api/agents/${id}/panel" "$body"
}

cmd_status() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api GET "/api/agents/${id}/panel"
}

cmd_feedback() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent required" >&2; return 1; }
    local id
    id="$(_resolve_agent_id "$ref")" || return 1
    _api GET "/api/agents/${id}/panel/feedback"
}

case "${1:-help}" in
    open)     shift; [ -z "${1:-}" ] && { echo "Error: agent required" >&2; exit 1; }; ref="$1"; shift; _panel_post open "$ref" "$@" ;;
    close)    shift; [ -z "${1:-}" ] && { echo "Error: agent required" >&2; exit 1; }; ref="$1"; shift; _panel_post close "$ref" "$@" ;;
    refresh)  shift; [ -z "${1:-}" ] && { echo "Error: agent required" >&2; exit 1; }; ref="$1"; shift; _panel_post refresh "$ref" "$@" ;;
    set)      shift; [ -z "${1:-}" ] && { echo "Error: agent required" >&2; exit 1; }; ref="$1"; shift; _panel_post set "$ref" "$@" ;;
    status)   shift; cmd_status "$@" ;;
    feedback) shift; cmd_feedback "$@" ;;
    help|--help|-h) show_help ;;
    --version|-v) echo "aimaestro-panel.sh v1.0.0" ;;
    *) echo "Error: unknown command: $1" >&2; echo "" >&2; show_help; exit 1 ;;
esac
