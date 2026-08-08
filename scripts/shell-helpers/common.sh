#!/bin/bash
# AI Maestro Common Shell Helper Functions
# Shared utilities for all agent scripts
#
# Usage: source "$(dirname "$0")/../scripts/shell-helpers/common.sh"
# Or for installed scripts: source ~/.local/share/aimaestro/shell-helpers/common.sh

HOSTS_CONFIG="${HOME}/.aimaestro/hosts.json"

# Hosts config is cached in a simple format (no associative arrays for compatibility)
_HOSTS_LOADED=""
_SELF_HOST_ID=""
_SELF_HOST_URL=""

# Get this machine's host ID and URL from the identity API or hosts.json
# Sets: _SELF_HOST_ID, _SELF_HOST_URL
_init_self_host() {
    # Already initialized
    if [ -n "$_SELF_HOST_ID" ]; then
        return 0
    fi

    # Try identity API first (most reliable)
    # SCEN-022 BUG-001 fix (P0): authenticate the caller. This inlined the AID bearer
    # and so 401'd every HUMAN (#55); it now shares the one resolution order in
    # get_auth_args — agent → bearer, human → aim_session cookie.
    local -a _id_auth_args=()
    get_auth_args _id_auth_args
    local identity
    identity=$(curl -s --max-time 5 "${_id_auth_args[@]}" "http://127.0.0.1:23000/api/hosts/identity" 2>/dev/null)
    if [ -n "$identity" ]; then
        _SELF_HOST_ID=$(echo "$identity" | jq -r '.host.id // empty' 2>/dev/null)
        _SELF_HOST_URL=$(echo "$identity" | jq -r '.host.url // empty' 2>/dev/null)
        if [ -n "$_SELF_HOST_ID" ] && [ -n "$_SELF_HOST_URL" ]; then
            return 0
        fi
    fi

    # Fallback: Find local host in hosts.json
    if [ -f "$HOSTS_CONFIG" ]; then
        local local_host
        local_host=$(jq -r '.hosts[] | select(.type == "local") | "\(.id)|\(.url)"' "$HOSTS_CONFIG" 2>/dev/null | head -1)
        if [ -n "$local_host" ]; then
            _SELF_HOST_ID="${local_host%%|*}"
            _SELF_HOST_URL="${local_host#*|}"
            return 0
        fi
    fi

    # Last resort: Use hostname
    _SELF_HOST_ID=$(hostname | tr '[:upper:]' '[:lower:]')
    _SELF_HOST_URL="http://${_SELF_HOST_ID}:23000"
}

# Get self host ID (this machine)
get_self_host_id() {
    _init_self_host
    echo "$_SELF_HOST_ID"
}

# Get self host URL (this machine)
get_self_host_url() {
    _init_self_host
    echo "$_SELF_HOST_URL"
}

# API_BASE — how THIS process reaches the server on THIS host.
#
# Always loopback (ai-maestro#81). This used to return get_self_host_url(), i.e.
# the LAN hostname — and on a host whose firewall drops inbound on the LAN
# interface, that hostname RESOLVES but REFUSES the connection, so every
# server-backed verb across all ~14 installed CLIs failed with a bare
# "(network)" error while the very same port answered fine on 127.0.0.1. The
# failure is invisible: "(network)" gives no hint that the BASE is the problem.
#
# A same-host caller has no reason to traverse the LAN interface. Loopback is
# also unconditionally reachable whenever the server is up: it binds `::`
# (dual-stack, which includes loopback) when Tailscale is present and
# 127.0.0.1-only otherwise.
#
# Deliberately NOT fixed by probing-then-falling-back: that spends a connect
# round-trip on every CLI invocation to discover something already known.
#
# get_self_host_url() is left ALONE on purpose — it is the URL this host
# ADVERTISES to peers, and a peer told "127.0.0.1" would call itself. Only the
# self-directed call is rewritten here; cross-host addressing goes through
# get_host_url().
get_api_base() {
    if [ -n "$AIMAESTRO_API_BASE" ]; then
        echo "$AIMAESTRO_API_BASE"
        return 0
    fi

    # Preserve the configured scheme and port; swap only the host for loopback.
    local url scheme rest port
    url="$(get_self_host_url)"
    case "$url" in
        https://*) scheme=https; rest="${url#https://}" ;;
        http://*)  scheme=http;  rest="${url#http://}"  ;;
        *)         scheme=http;  rest="$url"            ;;
    esac
    rest="${rest%%/*}"          # strip any path
    port="${rest##*:}"          # trailing :PORT, if present
    case "$port" in
        ''|*[!0-9]*) port=23000 ;;   # no port in the URL -> the project default
    esac

    echo "${scheme}://127.0.0.1:${port}"
}

# For backwards compatibility - use function instead
API_BASE="${AIMAESTRO_API_BASE:-}"

# Get URL for a host by id or name using jq (no associative arrays needed)
# Usage: get_host_url "mac-mini" or get_host_url "juans-mbp"
get_host_url() {
    local host_id="$1"
    _init_self_host

    # Check if this is the self host (case-insensitive)
    local host_id_lower=$(echo "$host_id" | tr '[:upper:]' '[:lower:]')
    local self_id_lower=$(echo "$_SELF_HOST_ID" | tr '[:upper:]' '[:lower:]')

    # BACKWARDS COMPATIBILITY: "local" always means this machine
    if [ "$host_id_lower" = "local" ]; then
        echo "$_SELF_HOST_URL"
        return 0
    fi

    if [ "$host_id_lower" = "$self_id_lower" ]; then
        echo "$_SELF_HOST_URL"
        return 0
    fi

    # No config file means only self is available
    if [ ! -f "$HOSTS_CONFIG" ]; then
        echo "Error: Unknown host '$host_id' (no hosts.json config)" >&2
        return 1
    fi

    # Query the hosts.json directly with jq (case-insensitive)
    local url
    url=$(jq -r --arg id "$host_id_lower" '.hosts[] | select((.id | ascii_downcase) == $id and .enabled == true) | .url' "$HOSTS_CONFIG" 2>/dev/null | head -1)

    # Try matching by name if id didn't work
    if [ -z "$url" ] || [ "$url" = "null" ]; then
        url=$(jq -r --arg name "$host_id" '.hosts[] | select((.name | ascii_downcase) == ($name | ascii_downcase) and .enabled == true) | .url' "$HOSTS_CONFIG" 2>/dev/null | head -1)
    fi

    if [ -n "$url" ] && [ "$url" != "null" ]; then
        echo "$url"
        return 0
    fi

    echo "Error: Unknown host '$host_id'" >&2
    return 1
}

# Check if a host exists
host_exists() {
    local host_id="$1"
    get_host_url "$host_id" >/dev/null 2>&1
}

# Check if a host ID refers to this machine (handles "local" for backwards compatibility)
is_self_host() {
    local host_id="$1"
    _init_self_host

    local host_id_lower=$(echo "$host_id" | tr '[:upper:]' '[:lower:]')
    local self_id_lower=$(echo "$_SELF_HOST_ID" | tr '[:upper:]' '[:lower:]')

    # BACKWARDS COMPATIBILITY: "local" always means this machine
    if [ "$host_id_lower" = "local" ]; then
        return 0
    fi

    # Check against actual self host ID
    if [ "$host_id_lower" = "$self_id_lower" ]; then
        return 0
    fi

    return 1
}

# List all available hosts
list_hosts() {
    _init_self_host
    echo "${_SELF_HOST_ID}: ${_SELF_HOST_URL} (this machine)"

    if [ -f "$HOSTS_CONFIG" ]; then
        # List remote hosts only (not the local one, and not legacy "local" entries)
        jq -r --arg self "$_SELF_HOST_ID" '.hosts[] | select(.enabled == true and (.id | ascii_downcase) != ($self | ascii_downcase) and (.id | ascii_downcase) != "local" and .type != "local") | "\(.id): \(.url)"' "$HOSTS_CONFIG" 2>/dev/null
    fi
}

# Legacy function for compatibility - now a no-op since we query directly
load_hosts_config() {
    _HOSTS_LOADED="1"
}

# Get the current tmux session name (optional - may not be in tmux)
get_session() {
    local session
    session=$(tmux display-message -p '#S' 2>/dev/null)
    if [ -z "$session" ]; then
        # Not in tmux - this is OK for external agents
        return 1
    fi
    echo "$session"
}

# Auto-detect agent identity from git repo name
# Returns repo name if in a git repository, empty otherwise
get_repo_name() {
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -n "$repo_root" ]; then
        basename "$repo_root"
    fi
}

# Lookup agent by tmux session name in registry
# AGENT-FIRST: The registry owns the mapping, not the session name format
# Returns agent info if found, empty if not
lookup_agent_by_session() {
    local session_name="$1"
    local api_url
    api_url=$(get_api_base)

    # SCEN-022 BUG-001 fix (P0), extended for #55: agent → bearer, human → cookie.
    local -a _lookup_auth_args=()
    get_auth_args _lookup_auth_args

    local response
    response=$(curl -s --max-time 5 "${_lookup_auth_args[@]}" "${api_url}/api/agents" 2>/dev/null)

    if [ -z "$response" ]; then
        return 1
    fi

    # Find agent that owns this tmux session
    # Agents can have multiple sessions, so we check the sessions array
    local agent_info
    agent_info=$(echo "$response" | jq -r --arg session "$session_name" '
        .agents[] |
        select(
            (.session.tmuxSessionName == $session) or
            (.sessions[]? | .tmuxSessionName == $session)
        ) |
        "\(.id)|\(.name)|\(.alias // .name)"
    ' 2>/dev/null | head -1)

    if [ -n "$agent_info" ] && [ "$agent_info" != "null" ]; then
        echo "$agent_info"
        return 0
    fi

    return 1
}

# Check if jq is available
check_jq() {
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is required but not installed" >&2
        echo "Install with: brew install jq" >&2
        return 1
    fi
}

# Lookup agent by working directory in registry
# Returns agent info if found, empty if not
lookup_agent_by_directory() {
    local current_dir="$1"
    local api_url
    api_url=$(get_api_base)

    # SCEN-022 BUG-001 fix (P0), extended for #55: agent → bearer, human → cookie.
    local -a _lookup_auth_args=()
    get_auth_args _lookup_auth_args

    # Query the agents API and find agent with matching workingDirectory
    local response
    response=$(curl -s --max-time 5 "${_lookup_auth_args[@]}" "${api_url}/api/agents" 2>/dev/null)

    if [ -z "$response" ]; then
        return 1
    fi

    # Find agent where workingDirectory matches or is parent of current_dir
    local agent_info
    agent_info=$(echo "$response" | jq -r --arg dir "$current_dir" '
        .agents[] |
        select(.workingDirectory != null and ($dir | startswith(.workingDirectory))) |
        "\(.id)|\(.name)|\(.alias // .name)"
    ' 2>/dev/null | head -1)

    if [ -n "$agent_info" ] && [ "$agent_info" != "null" ]; then
        echo "$agent_info"
        return 0
    fi

    return 1
}

# Resolve an agent ref (UUID, name, or alias) to its UUID via GET /api/agents?q=.
# Prints the UUID and returns 0, or prints an "Error: ..." to stderr and returns 1.
#
# WHY THIS IS SHARED (TRDD-17K0SHDQ, ai-maestro#46 defect class; also flagged as
# TRDD-COOLOZ1N hub box 4): this used to be pasted byte-identical into
# aimaestro-panel.sh, aimaestro-session.sh, and aimaestro-continuity.sh, and its
# multi-match branch was `jq -r '.agents[0].id // empty'` — SILENT FIRST-MATCH-WINS
# over an unsorted substring search. A ref that happened to match more than one
# agent resolved to WHICHEVER agent the server listed first, with no warning to
# the caller and no way to tell it had happened. Three copies meant the fix had to
# land three times (and be kept in sync forever); one shared definition means it
# lands once.
#
# The new contract: 0 matches -> refuse. 1 match -> use it. N>1 matches -> use it
# ONLY when exactly one candidate's `.name` equals the ref EXACTLY (case-sensitive
# first; if none match case-sensitively, fall back to a case-insensitive compare
# and accept it only if that too is unique). Anything else is a HARD FAIL that
# lists every candidate's NAME — never its uuid. Printing a stranger's uuid in an
# error message is the exact impersonation-invitation defect commit 1af95d49
# ("the identity refusal must not hand the caller a peer's uuid", ai-maestro#46)
# removed from amp-helper.sh; this resolver must not reintroduce it here.
_resolve_agent_id() {
    local ref="${1:-}"
    [ -z "$ref" ] && { echo "Error: agent (UUID or name) required" >&2; return 1; }

    # `self` / `<self>` — the CALLER's own agent, derived server-side from its AID
    # (GET /api/agents/me, self-only-by-construction; TRDD-COOLOZ1N ruling 2). The
    # bracketed form matches the fleet docs' notation; the bare form is what a hand
    # types. An agent literally NAMED "self" remains reachable by UUID — the token
    # takes priority here because "act on myself" must never silently resolve to a
    # similarly-named stranger.
    if [ "$ref" = "self" ] || [ "$ref" = "<self>" ]; then
        local base resp
        base="$(get_api_base)"
        local -a auth_args=()
        get_auth_args auth_args
        resp="$(curl -s --max-time 30 "${auth_args[@]}" "${base}/api/agents/me")" || {
            echo "Error: request to /api/agents/me failed (network)" >&2
            return 1
        }
        if ! printf '%s' "$resp" | jq -e . >/dev/null 2>&1; then
            echo "Error: invalid response from /api/agents/me (not JSON)" >&2
            return 1
        fi
        local self_id
        self_id="$(printf '%s' "$resp" | jq -r '.id // empty')"
        if [ -z "$self_id" ]; then
            local err
            err="$(printf '%s' "$resp" | jq -r '.error // .message // empty')"
            echo "Error: could not resolve self${err:+ — ${err}} (self requires AID_AUTH; a human caller names the agent explicitly)" >&2
            return 1
        fi
        printf '%s\n' "$self_id"
        return 0
    fi

    # Already a UUID — the API's own isValidUuid gate will reject a bad one.
    if [[ "$ref" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        printf '%s\n' "$ref"
        return 0
    fi

    # Reject anything that is not a plain tmux-safe name before it reaches a URL.
    if [[ ! "$ref" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "Error: invalid agent identifier '${ref}'" >&2
        return 1
    fi

    local base encoded
    base="$(get_api_base)"
    encoded="$(printf '%s' "$ref" | jq -sRr @uri)"
    local -a auth_args=()
    get_auth_args auth_args

    local resp
    resp="$(curl -s --max-time 30 "${auth_args[@]}" "${base}/api/agents?q=${encoded}")" || {
        echo "Error: request to /api/agents failed (network)" >&2
        return 1
    }

    # A non-JSON response (proxy error page, HTML 502) must be a FAILURE, never
    # "agent not found" — collapsing could-not-run into no-findings is the exact
    # conflation the repo's three-exit-code discipline exists to prevent.
    if ! printf '%s' "$resp" | jq -e . >/dev/null 2>&1; then
        echo "Error: invalid response from /api/agents (not JSON)" >&2
        return 1
    fi

    local count
    count="$(printf '%s' "$resp" | jq '.agents | length' 2>/dev/null)"
    [ -z "$count" ] && count=0

    if [ "$count" -eq 0 ]; then
        echo "Error: agent not found: ${ref}" >&2
        return 1
    fi

    if [ "$count" -eq 1 ]; then
        printf '%s' "$resp" | jq -r '.agents[0].id'
        return 0
    fi

    # N>1: only trust an unambiguous EXACT name match — never the unsorted
    # search's first hit.
    local exact_ids exact_count
    exact_ids="$(printf '%s' "$resp" | jq -r --arg r "$ref" '[.agents[] | select(.name == $r)] | .[].id')"
    exact_count="$(printf '%s' "$exact_ids" | grep -c . || true)"
    if [ "$exact_count" -eq 1 ]; then
        printf '%s\n' "$exact_ids"
        return 0
    fi

    if [ "$exact_count" -eq 0 ]; then
        local ci_ids ci_count
        ci_ids="$(printf '%s' "$resp" | jq -r --arg r "$ref" \
            '[.agents[] | select((.name | ascii_downcase) == ($r | ascii_downcase))] | .[].id')"
        ci_count="$(printf '%s' "$ci_ids" | grep -c . || true)"
        if [ "$ci_count" -eq 1 ]; then
            printf '%s\n' "$ci_ids"
            return 0
        fi
    fi

    local names
    names="$(printf '%s' "$resp" | jq -r '[.agents[].name] | join(", ")')"
    echo "Error: ambiguous agent ref '${ref}' — matches ${count} agents: ${names}" >&2
    echo "Use the exact agent name or its agent id instead." >&2
    return 1
}

# Initialize common variables - AGENT-FIRST approach
# Sets: SESSION (optional), AGENT_ID, HOST_ID
#
# Identity resolution priority:
#   1. Environment variables (explicit override)
#   2. Tmux session → Registry lookup (find agent that OWNS this session)
#   3. Working directory → Registry lookup (for sessionless agents)
#   4. Git repo name (external agent identity fallback)
#
# AGENT-FIRST PRINCIPLE:
#   - The agent registry is the source of truth for identity
#   - Session names are just names, not encoded identities
#   - An agent can have multiple sessions (future support)
#   - Sessions are properties of agents, not the other way around
#
# Environment variables:
#   AI_MAESTRO_AGENT_ID  - Agent identifier (name, alias, or UUID)
#   AI_MAESTRO_HOST_ID   - Host identifier (optional, defaults to self)
#
init_common() {
    check_jq || return 1

    # Reset variables
    SESSION=""
    AGENT_ID=""
    HOST_ID=""

    # Priority 1: Explicit identity via environment variables
    if [ -n "$AI_MAESTRO_AGENT_ID" ]; then
        AGENT_ID="$AI_MAESTRO_AGENT_ID"
        HOST_ID="${AI_MAESTRO_HOST_ID:-$(get_self_host_id)}"
    fi

    # Priority 2: Tmux session → Registry lookup
    # AGENT-FIRST: Query the registry to find which agent owns this session
    if [ -z "$AGENT_ID" ]; then
        SESSION=$(get_session 2>/dev/null) || true
        if [ -n "$SESSION" ]; then
            local agent_info
            agent_info=$(lookup_agent_by_session "$SESSION" 2>/dev/null)

            if [ -n "$agent_info" ]; then
                # Parse: id|name|alias
                AGENT_ID=$(echo "$agent_info" | cut -d'|' -f1)
                HOST_ID=$(get_self_host_id)
            fi
        fi
    fi

    # Priority 3: Lookup agent by working directory in registry
    # For agents without active sessions (external, sessionless)
    if [ -z "$AGENT_ID" ]; then
        local current_dir
        current_dir=$(pwd)
        local agent_info
        agent_info=$(lookup_agent_by_directory "$current_dir" 2>/dev/null)

        if [ -n "$agent_info" ]; then
            # Parse: id|name|alias
            AGENT_ID=$(echo "$agent_info" | cut -d'|' -f1)
            HOST_ID=$(get_self_host_id)
        fi
    fi

    # Priority 4: Auto-detect from git repo name (external agent identity)
    # This is a fallback for agents not registered in AI Maestro
    if [ -z "$AGENT_ID" ]; then
        local repo_name
        repo_name=$(get_repo_name)
        if [ -n "$repo_name" ]; then
            AGENT_ID="$repo_name"
            HOST_ID="${AI_MAESTRO_HOST_ID:-$(get_self_host_id)}"
            # Inform user about auto-detected identity
            echo "ℹ️  Using repo-based identity: ${AGENT_ID}@${HOST_ID}" >&2
            echo "   Register this agent or set AI_MAESTRO_AGENT_ID to override" >&2
        fi
    fi

    # Final check: Agent must have an identity
    if [ -z "$AGENT_ID" ]; then
        echo "Error: No agent identity found" >&2
        echo "" >&2
        echo "Options:" >&2
        echo "  1. Set environment variable: export AI_MAESTRO_AGENT_ID='my-agent'" >&2
        echo "  2. Register your tmux session: register-agent-from-session.mjs" >&2
        echo "  3. Run from an agent's working directory (registered in AI Maestro)" >&2
        echo "  4. Run from within a git repository" >&2
        return 1
    fi

    export SESSION
    export AGENT_ID
    export HOST_ID
}

# ─────────────────────────────────────────────────────────────────────────────
# THE TWO CALLERS (ai-maestro#55)
#
# An AGENT authenticates with its AID bearer token. A HUMAN authenticates with the
# `aim_session` cookie the dashboard login issues. Until now these helpers emitted
# ONLY the bearer, so every `aimaestro-*.sh` 401'd for a human — which is why the
# MANAGER could not run the #46 identity test from a dev session, and why the script
# layer was, for the human who owns the machine, unusable.
#
# Resolution order (first match wins):
#   1. $AID_AUTH               — an agent presents its own identity; it must win.
#   2. $AIMAESTRO_SESSION      — an explicit session token (CI, a one-off shell).
#   3. ~/.aimaestro/cli-session — the token `aimaestro-governance.sh login` writes.
#
# THE PASSWORD IS NEVER PART OF THIS. It is not an argument, not an env var, and
# never reaches these helpers: `login` prompts for it on the TTY, exchanges it for a
# session token once, and only the TOKEN is ever stored or sent. A password on argv
# leaks through `ps` and shell history (TRDD-E9BZ5P7S); an env var leaks into every
# child process.
# ─────────────────────────────────────────────────────────────────────────────

# Path of the session token written by `aimaestro-governance.sh login`.
cli_session_file() {
    echo "${AIMAESTRO_SESSION_FILE:-${HOME}/.aimaestro/cli-session}"
}

# Read the human's session token: $AIMAESTRO_SESSION, else the login file. Empty if
# neither exists (an unauthenticated human — the caller will get a 401 and a hint).
get_session_token() {
    if [ -n "${AIMAESTRO_SESSION:-}" ]; then
        printf '%s' "$AIMAESTRO_SESSION"
        return 0
    fi
    local f
    f="$(cli_session_file)"
    if [ -r "$f" ]; then
        tr -d '\r\n' < "$f"
    fi
}

# Get the auth header for API calls, as a quoted string.
# DEPRECATED for new code — the quoting is unsafe to re-split. Use get_auth_args.
# Returns: -H "Authorization: Bearer <aid>" | -H "Cookie: aim_session=<tok>" | empty
get_auth_header() {
    if [ -n "${AID_AUTH:-}" ]; then
        echo "-H \"Authorization: Bearer $AID_AUTH\""
        return 0
    fi
    local _tok
    _tok="$(get_session_token)"
    if [ -n "$_tok" ]; then
        echo "-H \"Cookie: aim_session=$_tok\""
    fi
}

# Build auth args array for curl calls
# Usage: local -a auth_args; get_auth_args auth_args; curl "${auth_args[@]}" ...
get_auth_args() {
    local -n _arr="$1"
    _arr=()
    if [ -n "${AID_AUTH:-}" ]; then
        _arr=(-H "Authorization: Bearer $AID_AUTH")
        return 0
    fi
    local _tok
    _tok="$(get_session_token)"
    if [ -n "$_tok" ]; then
        _arr=(-H "Cookie: aim_session=$_tok")
    fi
}

# Make an API query with common error handling
# Usage: api_query "GET" "/api/agents/${AGENT_ID}/endpoint" [extra_curl_args...]
# Authenticates the caller: AID bearer for an agent, aim_session cookie for a human.
api_query() {
    local method="$1"
    local endpoint="$2"
    shift 2
    local extra_args=("$@")

    # ONE resolution order for every caller — see get_auth_args. This used to inline
    # the bearer, so it 401'd every human even after the helper learned the cookie.
    local -a auth_args=()
    get_auth_args auth_args

    local api_base
    api_base=$(get_api_base)
    local url="${api_base}${endpoint}"
    local response

    response=$(curl -s --max-time 30 -X "$method" "${auth_args[@]}" "${extra_args[@]}" "$url" 2>/dev/null)

    if [ -z "$response" ]; then
        echo "Error: API request failed" >&2
        return 1
    fi

    # Check for success field in response
    local success
    success=$(echo "$response" | jq -r '.success // "true"' 2>/dev/null)

    if [ "$success" = "false" ]; then
        local error
        error=$(echo "$response" | jq -r '.error // "Unknown error"' 2>/dev/null)
        echo "Error: $error" >&2
        return 1
    fi

    echo "$response"
}

# Format and display JSON results nicely
format_result() {
    local response="$1"
    local field="${2:-.result}"
    echo "$response" | jq "$field" 2>/dev/null
}

# ============================================================================
# PATH Setup Functions (for installers)
# ============================================================================

# Setup ~/.local/bin in PATH - works on both macOS and Linux
# Usage: setup_local_bin_path [--quiet]
# Returns: 0 if PATH is configured, 1 if manual action needed
setup_local_bin_path() {
    local quiet=false
    if [ "$1" = "--quiet" ]; then
        quiet=true
    fi

    local INSTALL_DIR="$HOME/.local/bin"

    # Detect the appropriate shell config file
    local SHELL_RC=""
    if [[ "$SHELL" == *"zsh"* ]]; then
        SHELL_RC="$HOME/.zshrc"
    elif [[ "$SHELL" == *"bash"* ]]; then
        # On Linux, .bashrc is standard. On macOS, .bash_profile is often used.
        if [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        elif [ -f "$HOME/.bash_profile" ]; then
            SHELL_RC="$HOME/.bash_profile"
        else
            SHELL_RC="$HOME/.bashrc"
        fi
    else
        # Fallback: check what exists
        if [ -f "$HOME/.zshrc" ]; then
            SHELL_RC="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
            SHELL_RC="$HOME/.bashrc"
        else
            SHELL_RC="$HOME/.profile"
        fi
    fi

    # Check if already in PATH
    if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
        [ "$quiet" = false ] && echo "✅ ~/.local/bin is already in PATH"
        return 0
    fi

    # Dual guard: check for AI Maestro marker OR existing .local/bin PATH entry
    # Use pattern that requires /.local/bin to end at a word boundary (: " ' or EOL) to prevent
    # false positives like /.local/bin-extra matching
    if grep -qF "# AI Maestro" "$SHELL_RC" 2>/dev/null || grep -qE '/\.local/bin(["'"'"':]|$)' "$SHELL_RC" 2>/dev/null; then
        [ "$quiet" = false ] && echo "✅ PATH configured in $SHELL_RC (restart terminal or run: source $SHELL_RC)"
        # Add to current session
        export PATH="$HOME/.local/bin:$PATH"
        return 0
    fi

    # Add to shell config with marker comment to prevent future duplicates
    echo "" >> "$SHELL_RC"
    echo "# AI Maestro PATH (added by installer)" >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"

    # Add to current session
    export PATH="$HOME/.local/bin:$PATH"

    [ "$quiet" = false ] && echo "✅ Added ~/.local/bin to PATH in $SHELL_RC"
    [ "$quiet" = false ] && echo "   Restart terminal or run: source $SHELL_RC"

    return 0
}

# Verify scripts are accessible in PATH
# Usage: verify_scripts_in_path "script1.sh" "script2.sh" ...
verify_scripts_in_path() {
    local all_found=true
    for script in "$@"; do
        if command -v "$script" &> /dev/null; then
            echo "✅ $script is accessible"
        else
            echo "⚠️  $script not in PATH yet"
            all_found=false
        fi
    done

    if [ "$all_found" = false ]; then
        echo ""
        echo "Restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
    fi
}
