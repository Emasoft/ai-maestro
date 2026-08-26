#!/usr/bin/env bash
# AI Maestro Agent Commands
# CRUD commands: help, list, show, create, delete, update, rename, export, import
#
# Version: 1.0.0
# Requires: agent-helper.sh, agent-core.sh
#
# Usage: source "$(dirname "$0")/agent-commands.sh"

# Double-source guard
[[ -n "${_AGENT_COMMANDS_LOADED:-}" ]] && return 0
_AGENT_COMMANDS_LOADED=1

# ============================================================================
# HELP
# ============================================================================

cmd_help() {
    cat << 'EOF'
AI Maestro Agent CLI

Usage: aimaestro-agent.sh <command> [options]

Commands:
  list                          List all agents
  show <agent>                  Show agent details
  config <agent>                Consolidated config JSON (teams, repo, docker, tasks, AID)
  resolve <agent>|--cwd <path>  Resolve an agent to its tmux session name
  create <name>                 Create a new agent
  delete <agent>                Delete an agent
  update <agent>                Update agent properties
  rename <old> <new>            Rename an agent
  session <subcommand>          Manage agent sessions
  hibernate <agent>             Hibernate an agent
  wake <agent>                  Wake a hibernated agent
  restart <agent>               Restart an agent (hibernate + wake with verification)
  skill <subcommand>            Manage agent skills
  plugin <subcommand>           Manage Claude Code plugins
  export <agent>                Export agent to file
  import <file>                 Import agent from file
  presence                      Print the human user's presence (last input + idle window)
  probe <agent>                 Aggregate status + block-state + hook chat-state for one agent
  help                          Show this help

Examples:
  # Create a new agent with a project folder
  aimaestro-agent.sh create my-agent -d ~/Code/my-project -t "My task"

  # List the agents that are currently active
  aimaestro-agent.sh list --status active

  # Hibernate and later wake an agent
  aimaestro-agent.sh hibernate my-agent
  aimaestro-agent.sh wake my-agent --attach

  # Install a plugin for an agent (local scope)
  aimaestro-agent.sh plugin install my-agent feature-dev --scope local

  # Export and import an agent
  aimaestro-agent.sh export my-agent -o backup.json
  aimaestro-agent.sh import backup.json --name restored-agent

Run 'aimaestro-agent.sh <command> --help' for command-specific help.
EOF
}

# ============================================================================
# LIST
# ============================================================================

# VALIDATE BEFORE THE REQUEST (ai-maestro#114). The list filter is an exact string compare
# against `Agent.status`, whose enum is `active | idle | offline | deleted` (types/agent.ts).
# A value outside that set CANNOT match, and the old code accepted it silently: jq returned
# `{agents: []}` at exit 0, which reads as "no agents are in that state" rather than "that is
# not a state". `jq -e` does not rescue it — it fails only on a null/false last output, and an
# empty object is truthy. So an unmatchable status must be an ERROR here, not an empty list
# downstream.
#
# THE VALID SET LIVES HERE AND NOWHERE ELSE (TRDD-T3FXA0Y0). Two callers need it —
# `cmd_list`'s parser, and `validate_list_args` below, which runs BEFORE the API gate so a bad
# value is rejected locally instead of behind a 401. Enumerating the set twice is exactly how
# they would drift into disagreeing about what is valid, so they share this one function.
validate_status_value() {
    case "$1" in
        active|idle|offline|deleted|all) return 0 ;;
        hibernated)
            # Named separately because it is the one a caller reaches for on purpose:
            # ai-maestro-plugin#55 tells consumers to stop inferring liveness from
            # `Agent.status`, and this flag looks exactly like that fix. It is not —
            # hibernated agents read `offline`, so the field cannot carry the answer.
            print_error "--status hibernated cannot match: hibernation is not carried by Agent.status (a hibernated agent reads 'offline')."
            print_error "Use --status offline, or the dedicated hibernation probe once ai-maestro#113 lands."
            return 1 ;;
        *)
            print_error "Invalid --status '$1'. Valid values: active, idle, offline, deleted, all"
            return 1 ;;
    esac
}

# The pre-gate pass for `list`, called by `dispatch validate` before check_api_running.
# It answers only "is this argv locally invalid?" — it sets nothing and runs nothing.
#
# ⚠ IT MUST CONSUME VALUE-TAKING FLAGS THE SAME WAY `cmd_list` DOES. This is a second walk
# over the same argv, and the one way two walks diverge is disagreeing about which tokens are
# values: `list --format --status` makes `cmd_list` swallow `--status` as the format's value,
# so a validator that did not also consume `--format`'s value would find a `--status` that is
# not a flag at all and report the wrong error. Mirroring the consume-2 flags keeps them
# aligned; adding a value-taking flag to `cmd_list` means adding it here in the same edit.
#
# The structurally-correct successor, recorded rather than built: there is no shared
# `api_request()` in this file — 11+ verbs call `curl` directly — so the gate cannot yet live
# at the point of network use, which is where it belongs and which would remove the need for
# any pre-gate pass at all. That is a refactor of a frozen CLI and is its own card.
validate_list_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --status)
                [[ $# -lt 2 ]] && { print_error "--status requires a value"; return 1; }
                validate_status_value "$2" || return 1
                shift 2 ;;
            --format) shift 2 || return 0 ;;
            *) shift ;;
        esac
    done
    return 0
}

cmd_list() {
    local status_filter=""
    local format="table"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --status)
                [[ $# -lt 2 ]] && { print_error "--status requires a value"; return 1; }
                validate_status_value "$2" || return 1
                status_filter="$2"; shift 2 ;;
            --format)
                [[ $# -lt 2 ]] && { print_error "--format requires a value"; return 1; }
                format="$2"; shift 2 ;;
            -q|--quiet) format="names"; shift ;;
            --json) format="json"; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh list [options]

Options:
  --status <status>   Filter by status (active, idle, offline, deleted, all)
  --format <format>   Output format (table, json, names)
  -q, --quiet         Output names only (same as --format names)
  --json              Output as JSON (same as --format json)

Examples:
  # List all agents in table format
  aimaestro-agent.sh list

  # List all agents including hibernated
  aimaestro-agent.sh list --status all

  # List only the agents currently running a turn
  aimaestro-agent.sh list --status active

  # List stopped agents. NOTE: this includes hibernated ones — Agent.status cannot
  # distinguish them, which is why no hibernated filter is offered (ai-maestro#113).
  aimaestro-agent.sh list --status offline

  # Output as JSON (for scripting)
  aimaestro-agent.sh list --json

  # Output just names (for piping)
  aimaestro-agent.sh list -q
HELP
                return 0 ;;
            *) print_error "Unknown option: $1"; return 1 ;;
        esac
    done

    local response
    response=$(list_agents)

    if [[ -z "$response" ]]; then
        print_error "Failed to fetch agents"
        return 1
    fi

    # Filter by status if specified (unless "all" which shows everything)
    local agents="$response"
    if [[ -n "$status_filter" && "$status_filter" != "all" ]]; then
        # MEDIUM-7: Use jq -e for parse validation to catch errors
        if ! agents=$(echo "$response" | jq -e --arg status "$status_filter" \
            '.agents | map(select(.status == $status)) | {agents: .}' 2>/dev/null); then
            print_error "Failed to filter agents by status"
            return 1
        fi
    fi

    case "$format" in
        json)
            echo "$agents" | jq '.agents'
            ;;
        names)
            echo "$agents" | jq -r '.agents[].name'
            ;;
        table)
            print_header "AGENTS"
            echo "────────────────────────────────────────────────────────────────────────────────────────────────────"
            printf "%-25s %-12s %-8s %-40s\n" "NAME" "STATUS" "SESSIONS" "WORKING DIRECTORY"
            echo "────────────────────────────────────────────────────────────────────────────────────────────────────"

            # LOW-006: Disable globbing in loop to prevent expansion
            # MEDIUM-2: Use boolean flag instead of eval for safer shell option restore
            local noglob_was_off=false
            if [[ ! -o noglob ]]; then
                noglob_was_off=true
                set -f
            fi
            local agent_count=0
            echo "$agents" | jq -r '.agents[] | "\(.name)|\(.status // "unknown")|\(.sessions | length)|\(.workingDirectory // "-")"' | \
            while IFS='|' read -r name status sessions working_dir; do
                ((agent_count++)) || true
                # Truncate name and working_dir if too long
                [[ ${#name} -gt 25 ]] && name="${name:0:22}..."
                [[ ${#working_dir} -gt 40 ]] && working_dir="${working_dir:0:37}..."

                # Color status
                local status_display="$status"
                if [[ "$status" == "online" || "$status" == "active" ]]; then
                    status_display="${GREEN}${status}${NC}"
                elif [[ "$status" == "hibernated" ]]; then
                    status_display="${CYAN}hibernated${NC}"
                elif [[ "$status" == "offline" ]]; then
                    status_display="${YELLOW}offline${NC}"
                fi

                # MEDIUM-005: Use %s for variable content to avoid format string issues
                printf "%-25s %b%-12s %-8s %s${NC}\n" "$name" "$status_display" "" "$sessions" "$working_dir"
            done
            # MEDIUM-2: Restore noglob using boolean flag instead of eval
            [[ "$noglob_was_off" == true ]] && set +f || true
            echo "────────────────────────────────────────────────────────────────────────────────────────────────────"
            local total
            total=$(echo "$agents" | jq -r '.agents | length' 2>/dev/null)
            echo "Total: ${total:-0} agent(s)"
            ;;
    esac
}

# ============================================================================
# SHOW
# ============================================================================

# presence — print the human user's presence (GET /api/users/me/presence).
# #45: the AMAMA presence-tracker skill reads the user's availability through this
# FROZEN CLI verb instead of a direct /api call (the decoupling invariant). Read-only
# verb; auth via AID_AUTH when set (the endpoint is auth-gated like every agent route).
cmd_presence() {
    case "${1:-}" in
        -h|--help)
            echo "Usage: aimaestro-agent.sh presence    Print the human user's presence (last input epoch + idle window)"
            return 0 ;;
    esac
    local api_base
    api_base=$(get_api_base) || return 1
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    response=$(curl -s --max-time 30 "${auth_args[@]}" "${api_base}/api/users/me/presence" 2>/dev/null)
    if [[ -z "$response" ]]; then
        print_error "Failed to fetch presence"
        return 1
    fi
    echo "$response"
}

# cmd_probe — one aggregating read of an agent's registry status, pane block-state, and hook
# chat-state (TRDD-LT5N2JA4). This is the script-layer wrap the MANAGER/CHIEF-OF-STAFF skills
# call so a supervisor never reaches for `/api/*` directly (R23). Same auth as `show`/`block-
# state`: the route is strict and gated on `unblock-prompt` (MANAGER any, COS own-team, never
# an ASSISTANT, self always) because the pane excerpt it can surface is the same sensitive
# content block-state guards.
cmd_probe() {
    local agent=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: aimaestro-agent.sh probe <agent>"
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done
    [[ -z "$agent" ]] && { print_error "Agent name or ID required"; return 1; }

    resolve_agent "$agent" || return 1
    local agent_id="$RESOLVED_AGENT_ID"

    local api_base
    api_base=$(get_api_base)
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    response=$(curl -s --max-time 30 "${auth_args[@]}" "${api_base}/api/agents/${agent_id}/probe" 2>/dev/null)
    if [[ -z "$response" ]]; then
        print_error "Failed to fetch agent probe"
        return 1
    fi
    if ! echo "$response" | jq -e '.status' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
        print_error "${error_msg:-Invalid response from API}"
        return 1
    fi
    echo "$response"
}

# cmd_subconscious — is an agent's subconscious loop running, and when did it last run?
# (ai-maestro#64 residual 1.)
#
# A THIN GET WRAPPER, and deliberately only that. The route already exists and the skill layer
# already teaches the capability; what was missing was any way to reach it from the frozen CLI,
# so an agent had to call the HTTP API directly — the R23 bypass the script layer exists to
# prevent.
#
# THE SKILL DOCUMENTS THE WRONG PATH. `skills/memory-search/references/REFERENCE.md:154` cites
# `GET /api/agents/{id}/subconscious/status`; the real route is
# `GET /api/agents/{id}/subconscious` — there is no `/status` segment. That is a core-plugin doc
# fix, not ours, but it is why "the verb is missing" and "the path 404s" looked like one bug.
#
# THE OTHER HALF OF residual 1 IS GONE ON PURPOSE, not unbuilt: the manual re-index verb
# (`POST …/subconscious/index-delta`, REFERENCE.md:170) was REMOVED in TRDD-YEE33F3A because it
# returned 400 for every possible input once the RAG subsystem was deleted (TRDD-70a521d9) and
# had zero callers. Do not "restore" it — automatic indexing already runs.
#
# AUTHORIZATION IS THE SERVICE'S, NOT OURS: an agent may read only its OWN subconscious status;
# the system owner may read any (agents-subconscious-service.ts). This wrapper adds no gate of
# its own and inherits `aimaestro-agent.sh`'s `check_api_running` + AID_AUTH bearer.
cmd_subconscious() {
    local agent="" format="table"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --json)  format="json";  shift ;;
            --table) format="table"; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh subconscious <agent> [--json|--table]

Report whether an agent's subconscious loop is running, and its last run.

Options:
  --table   Human-readable (default)
  --json    Raw JSON

An agent may read only its OWN status; the system owner may read any.
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done
    [[ -z "$agent" ]] && { print_error "Agent name or ID required"; return 1; }

    resolve_agent "$agent" || return 1
    local agent_id="$RESOLVED_AGENT_ID"

    local api_base; api_base=$(get_api_base)
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    response=$(curl -s --max-time 15 "${auth_args[@]}" "${api_base}/api/agents/${agent_id}/subconscious" 2>/dev/null)

    if [[ -z "$response" ]]; then
        print_error "Failed to fetch subconscious status for ${RESOLVED_ALIAS:-$agent}"
        return 1
    fi
    # A refusal must NOT render as `running: false`. "I could not look" and "it is not running"
    # are different answers, and collapsing them is how a permissions error gets read as an
    # unhealthy agent — the same conflation cmd_hibernation guards against.
    if echo "$response" | jq -e 'has("error")' >/dev/null 2>&1; then
        print_error "$(echo "$response" | jq -r '.error')"
        return 1
    fi

    if [[ "$format" == "json" ]]; then
        echo "$response"
        return 0
    fi

    echo "$response" | jq -r '
      "Agent:            \(.agentName // .agentId // "unknown")",
      "Subconscious:     \(if .isRunning then "RUNNING" else "not running" end)",
      (if .status then
         "  started:        \(.status.startedAt // "—")",
         "  last run:       \(.status.lastMessageRun // "never")",
         "  last result:    \(.status.lastMessageResult // "—")",
         "  total runs:     \(.status.totalMessageRuns // 0)",
         "  check interval: \(.status.messageCheckInterval // "—")"
       else
         "  (no status record — the loop has never started)"
       end)'
}

# cmd_hibernation — is each agent deliberately ASLEEP, or BROKEN? (TRDD-14HI8ZPR)
#
# Nothing in the registry answers this: Agent['status'] is active|idle|offline|deleted — four
# values, NONE of them `hibernated` (types/agent.ts:465; this comment and the route's twin both
# said three until ai-maestro#114 caught the omission, and a reader checking the claim against
# the real type would have found a mismatch that makes the correct argument below look wrong). So a
# hibernated agent, a crashed one and one never woken ALL read `offline`. Measured on a
# live host: 9 agents, every one `offline`, of which 6 were cleanly hibernated and 3 had
# crashed. A guardian reporting from `status` alone therefore cannot tell a deliberate
# sleep from an outage.
#
# States: running | hibernated | crashed | never_woken.
#   hibernated is HEALTHY — it must never be reported as a fault.
#   crashed means the clean hibernate path never ran: hibernateAgent unpersists the
#   session, so a surviving persistence record proves the shutdown was not clean.
#
# THIS LIVES HERE, ON THE AUTHENTICATED SCRIPT, ON PURPOSE. A roster names every agent,
# its uuid and its tmux session name — a map of the fleet, the same metadata class
# /api/agents gates ("CC-GOV-008: Auth required to prevent metadata leaks via
# Tailscale"). aimaestro-agent.sh already runs `check_api_running || exit 1` before its
# dispatch table and sends the AID_AUTH bearer, so this subcommand inherits both instead
# of duplicating — and drifting from — that boundary. An earlier revision shipped a
# standalone CLI that read ~/.aimaestro with no auth and worked with the server DOWN;
# it was reverted (3f069c22). With no server there is nothing to validate signatures
# against, so nothing may execute.
#
# The JANITOR does not call this. The in-server daemon publishes each janitor the slice
# it is entitled to, under that project's own .janitor/daemon_responses/.
cmd_hibernation() {
    local format="table"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --json)  format="json"; shift ;;
            --table) format="table"; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh hibernation [options]

Report whether each agent is asleep or broken.

Options:
  --table   Human-readable table (default)
  --json    Raw JSON roster

States:
  running       a live tmux session exists
  hibernated    cleanly asleep — a HEALTHY state, never a fault
  crashed       still persisted but tmux is gone; the clean hibernate never ran
  never_woken   created but never started

Also reports persistence rows referencing agents no longer in the registry
(the class behind the 2026-07-25 agent-regrowth incident).
HELP
                return 0 ;;
            *) print_error "Unknown option: $1"; return 1 ;;
        esac
    done

    local api_base
    api_base=$(get_api_base) || return 1
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    response=$(curl -s --max-time 30 "${auth_args[@]}" "${api_base}/api/agents/hibernation" 2>/dev/null)
    if [[ -z "$response" ]]; then
        print_error "Failed to fetch the hibernation roster"
        return 1
    fi
    # An auth failure returns a JSON {error} with a 200-shaped body here; surface it rather
    # than rendering an empty table, which would read as "the fleet is empty" (the
    # could-not-look vs looked-and-found-nothing conflation this repo bans elsewhere).
    if echo "$response" | jq -e 'has("error")' >/dev/null 2>&1; then
        print_error "$(echo "$response" | jq -r '.error')"
        return 1
    fi

    if [[ "$format" == "json" ]]; then
        echo "$response"
        return 0
    fi

    echo "$response" | jq -r '
        (.counts | "running=\(.running)  hibernated=\(.hibernated)  crashed=\(.crashed)  never_woken=\(.never_woken)  orphaned=\(.orphaned)"),
        "",
        (.agents[] | "\(.state)\t\(.name // .agentId)\t\(.reason)"),
        (if (.orphanedPersistedSessions | length) > 0 then
            "", "orphaned persistence rows (agent no longer in the registry):",
            (.orphanedPersistedSessions[] | "orphaned\t\(.name // .agentId)\tsession \(.sessionId)")
         else empty end)
    ' | column -t -s $'\t'
}

# cmd_config — the consolidated agent config a monitoring agent (the janitor,
# MANAGER, …) needs in ONE call: the full registry record (launch program +
# programArgs, governance title, workdir, hooks, deployment.cloud), the teams it
# belongs to (reverse lookup), its normalized GitHub repo, whether that repo is
# docker-based, its pending non-terminal kanban tasks, and its AID PUBLIC key.
#
# Deliberately a separate verb from `show`: `show` is the human-facing summary of
# the agent record, `config` is the machine-facing superset. Read-only, so the
# route is non-strict and any authenticated caller may read any agent (this is a
# fleet-MONITOR surface — it exposes the public key only, never the private one).
cmd_config() {
    local agent=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                echo "Usage: aimaestro-agent.sh config <agent>"
                echo ""
                echo "Print the consolidated agent configuration as JSON:"
                echo "  agent, teams, githubRepo, repoDocker, pendingTasks, aidPublicKey"
                return 0 ;;
            -*) print_error "Unknown option for 'config': $1"; return 1 ;;
            *)  agent="$1"; shift ;;
        esac
    done

    if [[ -z "$agent" ]]; then
        print_error "Usage: aimaestro-agent.sh config <agent>"
        return 1
    fi

    resolve_agent "$agent" || return 1

    local api_base
    api_base=$(get_api_base) || return 1
    local -a auth_args=()
    _build_auth_args auth_args

    local response
    response=$(curl -s --max-time 30 "${auth_args[@]}" \
        "${api_base}/api/agents/${RESOLVED_AGENT_ID}/full" 2>/dev/null)
    if [[ -z "$response" ]]; then
        print_error "Failed to fetch config for agent '${agent}'"
        return 1
    fi

    # Surface a server-side error instead of printing an error object as if it
    # were the config (the caller pipes this into jq and would read `.agent` as
    # null rather than seeing the 403/404).
    local err
    err=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
    if [[ -n "$err" ]]; then
        print_error "$err"
        return 1
    fi

    echo "$response" | jq '.'
}

cmd_show() {
    local agent=""
    local format="pretty"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --format)
                [[ $# -lt 2 ]] && { print_error "--format requires a value"; return 1; }
                format="$2"; shift 2 ;;
            --json) format="json"; shift ;;
            -h|--help)
                echo "Usage: aimaestro-agent.sh show <agent> [--format pretty|json]"
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name or ID required"; return 1; }

    # Use the unified resolve_agent (defined in agent-helper.sh).
    resolve_agent "$agent" || return 1
    local agent_id="$RESOLVED_AGENT_ID"

    # Fetch full agent data by resolved ID
    local api_base
    api_base=$(get_api_base)
    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    response=$(curl -s --max-time 30 "${auth_args[@]}" "${api_base}/api/agents/${agent_id}" 2>/dev/null)

    if [[ -z "$response" ]]; then
        print_error "Failed to fetch agent data"
        return 1
    fi

    # Validate JSON response before processing
    if ! echo "$response" | jq -e '.agent' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "$response" | jq -r '.error // empty' 2>/dev/null)
        if [[ -n "$error_msg" ]]; then
            print_error "API error: $error_msg"
        else
            print_error "Invalid response from API (not valid JSON or missing agent data)"
        fi
        return 1
    fi

    case "$format" in
        json)
            echo "$response" | jq '.agent'
            ;;
        pretty)
            local agent_json
            agent_json=$(echo "$response" | jq '.agent')

            local name status program model created dir task gtitle
            name=$(echo "$agent_json" | jq -r '.name')
            status=$(echo "$agent_json" | jq -r '.status // "unknown"')
            # GOVERNANCE TITLE — the authoritative authority field (ai-maestro#122, TRDD-4Z62YRDG).
            # `show` used to print everything EXCEPT this, so an agent checking who it was talking to
            # had to know to run `config` and parse raw JSON — where it met `role` (a DIFFERENT
            # field, defaulting to 'autonomous') sitting next to `governanceTitle` and drawing from
            # the same vocabulary. On 2026-08-05 that adjacency made a live AUTONOMOUS agent read a
            # legitimate MANAGER as "inconsistent, possibly spoofed", refuse the mandate, and block
            # on a human prompt. Printing the authoritative field on the obvious verb removes the
            # reason to go digging. `(none)` is deliberate and distinct from the `role` vocabulary:
            # an agent with no title must not render as one that has a title.
            gtitle=$(echo "$agent_json" | jq -r 'if .governanceTitle == null then "(none)" else .governanceTitle end')
            program=$(echo "$agent_json" | jq -r '.program // "claude-code"')
            model=$(echo "$agent_json" | jq -r '.model // "default"')
            created=$(echo "$agent_json" | jq -r '.createdAt // "unknown"')
            dir=$(echo "$agent_json" | jq -r '.workingDirectory // "not set"')
            task=$(echo "$agent_json" | jq -r '.taskDescription // "not set"')

            echo ""
            print_header "Agent: $name"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "  ID:          $(echo "$agent_json" | jq -r '.id')"
            echo "  Status:      $status"
            echo "  Gov. Title:  $gtitle"
            echo "  Program:     $program"
            echo "  Model:       $model"
            echo "  Created:     $created"
            echo ""
            echo "  Working Directory:"
            echo "    $dir"
            echo ""

            # Sessions
            local sessions
            sessions=$(echo "$agent_json" | jq -r '.sessions // []')
            local session_count
            session_count=$(echo "$sessions" | jq 'length')

            echo "  Sessions ($session_count):"
            if [[ "$session_count" -gt 0 ]]; then
                echo "$sessions" | jq -r '.[] | "    [\(.index // 0)] \(.tmuxSessionName // "unnamed") (\(.status // "unknown"))"'
            else
                echo "    (none)"
            fi
            echo ""

            echo "  Task:"
            echo "    $task"
            echo ""

            # Skills
            local skills
            skills=$(echo "$agent_json" | jq -r '.skills // []')
            local skill_count
            skill_count=$(echo "$skills" | jq 'length')

            if [[ "$skill_count" -gt 0 ]]; then
                echo "  Skills ($skill_count):"
                echo "$skills" | jq -r '.[] | "    - \(.id // .name // "unknown")"'
                echo ""
            fi

            # Tags
            local tags
            tags=$(echo "$agent_json" | jq -r '.tags // []')
            local tag_count
            tag_count=$(echo "$tags" | jq 'length')

            if [[ "$tag_count" -gt 0 ]]; then
                echo "  Tags: $(echo "$tags" | jq -r 'join(", ")')"
                echo ""
            fi
            ;;
    esac
}

# ============================================================================
# CREATE
# ============================================================================

cmd_create() {
    local name="" dir="" program="claude-code" model="" task="" tags=""
    local no_session=false no_folder=false force_folder=false
    # Additive (frozen-interface-safe): optional fields the POST /api/agents API
    # already accepts but the CLI previously could NOT set — so a fully-specified
    # agent (governance title, team, role-plugin, label, avatar, …) can be created
    # in ONE script call. This closes the gap that forced the CHIEF-OF-STAFF to
    # call the server API directly when staffing a team. Existing flags/behavior
    # are unchanged; these only take effect when their flag is passed.
    local title="" team="" label="" avatar="" client="" plugin="" owner="" github_repo=""
    local -a program_args=()  # Arguments to pass to the program (after --)

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -d|--dir)
                [[ $# -lt 2 ]] && { print_error "-d/--dir requires a value"; return 1; }
                dir="$2"; shift 2 ;;
            -p|--program)
                [[ $# -lt 2 ]] && { print_error "-p/--program requires a value"; return 1; }
                program="$2"; shift 2 ;;
            -m|--model)
                [[ $# -lt 2 ]] && { print_error "-m/--model requires a value"; return 1; }
                model="$2"; shift 2 ;;
            -t|--task)
                [[ $# -lt 2 ]] && { print_error "-t/--task requires a value"; return 1; }
                task="$2"; shift 2 ;;
            --tags)
                [[ $# -lt 2 ]] && { print_error "--tags requires a value"; return 1; }
                tags="$2"; shift 2 ;;
            --no-session) no_session=true; shift ;;
            --no-folder) no_folder=true; shift ;;
            --force-folder) force_folder=true; shift ;;
            --title)
                [[ $# -lt 2 ]] && { print_error "--title requires a value"; return 1; }
                title="$2"; shift 2 ;;
            --team)
                [[ $# -lt 2 ]] && { print_error "--team requires a value"; return 1; }
                team="$2"; shift 2 ;;
            --label)
                [[ $# -lt 2 ]] && { print_error "--label requires a value"; return 1; }
                label="$2"; shift 2 ;;
            --avatar)
                [[ $# -lt 2 ]] && { print_error "--avatar requires a value"; return 1; }
                avatar="$2"; shift 2 ;;
            --client)
                [[ $# -lt 2 ]] && { print_error "--client requires a value"; return 1; }
                client="$2"; shift 2 ;;
            --plugin)
                [[ $# -lt 2 ]] && { print_error "--plugin requires a value"; return 1; }
                plugin="$2"; shift 2 ;;
            --owner)
                [[ $# -lt 2 ]] && { print_error "--owner requires a value"; return 1; }
                owner="$2"; shift 2 ;;
            --github-repo)
                [[ $# -lt 2 ]] && { print_error "--github-repo requires a value"; return 1; }
                github_repo="$2"; shift 2 ;;
            --)
                # Everything after -- is passed to the program
                shift
                program_args=("$@")
                break ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh create <name> [--dir <path>] [options] [-- <program-args>...]

Options:
  -d, --dir <path>       Working directory, full path. OPTIONAL — defaults to
                         ~/agents/<name>/, which is the only location the server
                         accepts for an agent folder anyway.
  -p, --program <prog>   Program to run (default: claude-code)
  -m, --model <model>    AI model (e.g., claude-sonnet-4)
  -t, --task <desc>      Task description
  --tags <t1,t2>         Comma-separated tags
  --no-session           Don't create tmux session
  --no-folder            Don't create project folder
  --force-folder         Use existing directory (by default, errors if exists)
  --title <title>        Governance title: member, chief-of-staff, architect,
                         orchestrator, integrator, maintainer, autonomous, manager
  --team <team-uuid>     Assign the agent to this team (team UUID)
  --label <name>         Persona display name (defaults to the agent name)
  --avatar <url|emoji>   Avatar URL or emoji
  --plugin <name>        Role-plugin to install (else auto-selected from --title)
  --client <client>      Client: claude, codex, gemini, … (defaults to program)
  --owner <owner>        Owner username
  --github-repo <o/r>    Associated GitHub repo (owner/repo)

Program Arguments:
  Use -- to pass arguments to the program when it starts.

Examples:
  # Create agent with new project folder
  aimaestro-agent.sh create my-agent --dir ~/Code/my-project

  # Create agent with specific model and task
  aimaestro-agent.sh create backend-dev --dir ~/Code/backend \
    -m claude-sonnet-4 -t "Develop backend API"

  # Create agent using existing folder
  aimaestro-agent.sh create existing-project --dir ~/Code/old-project --force-folder

  # Create agent with tags
  aimaestro-agent.sh create utils-agent --dir ~/Code/utils --tags "utils,tools"

  # Create agent without tmux session (just register)
  aimaestro-agent.sh create headless-agent --dir ~/Code/headless --no-session

  # Create agent with program arguments (passed to claude)
  aimaestro-agent.sh create my-agent --dir ~/Code/project -- --continue --chrome

  # Create a fully-specified team member in ONE call (title + team) — what a
  # CHIEF-OF-STAFF needs when staffing a team (no direct API call required)
  aimaestro-agent.sh create backend-dev --dir ~/agents/backend-dev \
    --title member --team 1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e --label "Backend Dev"
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) name="$1"; shift ;;
        esac
    done

    # Validate name
    validate_agent_name "$name" || return 1

    # Check for name collision (including hibernated agents)
    if check_agent_exists "$name"; then
        print_error "Agent with name '$name' already exists"
        print_error "Use a different name or delete the existing agent first"
        print_error "To see all agents (including hibernated): aimaestro-agent.sh list --status all"
        return 1
    fi

    # Validate program - must be in whitelist
    local allowed_programs="claude-code claude codex aider cursor gemini opencode none terminal"
    # tr, not ${program,,}: case-conversion expansion is bash >= 4 and macOS /bin/bash 3.2
    # dies on it with "bad substitution" (TRDD-ARY3NRFC family).
    local program_lower
    program_lower="$(printf '%s' "$program" | tr '[:upper:]' '[:lower:]')"
    if [[ ! " $allowed_programs " =~ [[:space:]]"${program_lower}"[[:space:]] ]]; then
        print_error "Invalid program: $program"
        print_error "Allowed programs: $allowed_programs"
        return 1
    fi

    # Validate model format if provided
    if [[ -n "$model" ]]; then
        # Expected: sonnet, opus, haiku, fable, or claude-{family}-{version}
        # (fable added 2026-07-07 — Claude 5 family; regex without it rejected valid ids)
        if [[ ! "$model" =~ ^(claude-)?(sonnet|opus|haiku|fable)(-[0-9]+(-[0-9]+)?(-[0-9]{8})?)?$ ]]; then
            print_error "Invalid model format: $model"
            print_error "Expected format: sonnet, opus, haiku, fable, or claude-{family}-{version}"
            print_error "Examples: sonnet, claude-sonnet-5, claude-opus-4-8, claude-fable-5"
            return 1
        fi
    fi

    # --dir is OPTIONAL and defaults to ~/agents/<name>/ (ai-maestro#76 op 2).
    #
    # WHY THAT DEFAULT, AND WHY IT IS NOT A NEW CONVENTION. `~/agents/<name>/` is already the
    # ONLY place an agent folder may live: the Wizard's G03-ENFORCE guard rejects any other
    # target, and DeleteAgent refuses `alsoDeleteFolder` for a workdir outside it. Requiring
    # --dir therefore made every caller retype the one path the server would accept anyway, and
    # invited them to type a different one and be refused later. The default makes the CLI agree
    # with the UI.
    #
    # ASSIGNED HERE, ABOVE the canonicalization + HOME-containment guard below, ON PURPOSE: the
    # default is validated by exactly the same code as a caller-supplied path. A default that
    # skipped that guard would be the bug. `$name` has already passed `validate_agent_name` at
    # this point, so it cannot smuggle a traversal into the folder name.
    #
    # ANNOUNCED, not silent: creating a folder somewhere the caller did not name is a surprise
    # worth one line. And note what this does NOT add — there is still no way to register an
    # agent WITHOUT a folder; a registry row with no folder is the orphan state behind the
    # 2026-07-25 folder-regrowth incident.
    if [[ -z "$dir" ]]; then
        dir="$HOME/agents/$name"
        print_info "No --dir given — using the default agent folder: $dir"
    fi

    # MEDIUM-6: Validate directory path is safe using proper canonicalization that
    # actually collapses `..` and resolves symlinks. SECURITY: `command -v realpath`
    # is NOT sufficient — stock macOS ships a BSD `realpath` that LACKS `-m`, so the
    # old guard would silently fall back to the UNRESOLVED $dir; a path like
    # "$HOME/agents/../../etc" then still starts with $HOME and passes the
    # containment check below while actually escaping HOME. Feature-test `-m`
    # specifically (same pattern as validate_cache_path in agent-core.sh), then
    # python3, then a manual `cd -P` that canonicalizes the parent.
    local resolved_dir
    if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
        resolved_dir=$(realpath -m "$dir" 2>/dev/null) || resolved_dir="$dir"
    elif command -v python3 >/dev/null 2>&1; then
        resolved_dir=$(python3 -c "import os,sys; print(os.path.normpath(os.path.join(os.getcwd(), sys.argv[1])))" "$dir" 2>/dev/null) || resolved_dir="$dir"
    else
        # Manual fallback: canonicalize the parent (resolves symlinks + ..) then append basename
        resolved_dir=$(cd -P -- "$(dirname "$dir")" 2>/dev/null && pwd)/$(basename -- "$dir") 2>/dev/null || resolved_dir="$dir"
    fi
    # Note: /tmp on macOS is a symlink to /private/tmp, so check both
    # Also resolve HOME in case it contains symlinks (same feature-test discipline)
    local resolved_home
    if command -v realpath >/dev/null 2>&1 && realpath -m / >/dev/null 2>&1; then
        resolved_home=$(realpath -m "$HOME" 2>/dev/null) || resolved_home="$HOME"
    elif command -v python3 >/dev/null 2>&1; then
        resolved_home=$(python3 -c "import os,sys; print(os.path.normpath(os.path.join(os.getcwd(), sys.argv[1])))" "$HOME" 2>/dev/null) || resolved_home="$HOME"
    else
        resolved_home=$(cd -P -- "$HOME" 2>/dev/null && pwd) || resolved_home="$HOME"
    fi
    if [[ "$resolved_dir" != "$resolved_home"* && "$resolved_dir" != "/opt"* && "$resolved_dir" != "/tmp"* && "$resolved_dir" != "/private/tmp"* ]]; then
        print_error "Directory must be under home directory, /opt, or /tmp"
        return 1
    fi
    dir="$resolved_dir"

    # Check if directory already exists (unless --force-folder is specified)
    if [[ -d "$dir" && "$force_folder" == false ]]; then
        print_error "Directory already exists: $dir"
        print_error "Use --force-folder to use an existing directory"
        return 1
    fi

    # Create project folder
    if [[ "$no_folder" == false ]]; then
        print_info "Creating project folder: $dir"
        # MEDIUM-002: Check mkdir result
        if ! mkdir -p "$dir"; then
            print_error "Failed to create directory: $dir"
            return 1
        fi
        create_project_template "$dir" "$name"
    fi

    # Build JSON payload
    local create_session="true"
    [[ "$no_session" == true ]] && create_session="false"

    local payload
    payload=$(jq -n \
        --arg name "$name" \
        --arg program "$program" \
        --arg dir "$dir" \
        --argjson createSession "$create_session" \
        '{
            name: $name,
            program: $program,
            workingDirectory: $dir,
            createSession: $createSession
        }')

    # Add optional fields
    [[ -n "$model" ]] && payload=$(echo "$payload" | jq --arg m "$model" '. + {model: $m}')
    [[ -n "$task" ]] && payload=$(echo "$payload" | jq --arg t "$task" '. + {taskDescription: $t}')
    [[ -n "$tags" ]] && payload=$(echo "$payload" | jq --arg t "$tags" '. + {tags: ($t | split(","))}')
    # Program arguments (passed after --) - sent as string
    if [[ ${#program_args[@]} -gt 0 ]]; then
        local args_str="${program_args[*]}"
        payload=$(echo "$payload" | jq --arg a "$args_str" '. + {programArgs: $a}')
    fi

    # Additive optional fields (see the `local` block above). Each is added to the
    # payload ONLY when the caller passed its flag, so omitting them yields the exact
    # same request as before — existing call sites are unaffected. The server
    # (CreateAgent pipeline + the route's zod schema) stays the single source of
    # truth that validates these values.
    [[ -n "$title" ]]       && payload=$(echo "$payload" | jq --arg v "$title"       '. + {governanceTitle: $v}')
    [[ -n "$team" ]]        && payload=$(echo "$payload" | jq --arg v "$team"        '. + {teamId: $v}')
    [[ -n "$label" ]]       && payload=$(echo "$payload" | jq --arg v "$label"       '. + {label: $v}')
    [[ -n "$avatar" ]]      && payload=$(echo "$payload" | jq --arg v "$avatar"      '. + {avatar: $v}')
    [[ -n "$client" ]]      && payload=$(echo "$payload" | jq --arg v "$client"      '. + {client: $v}')
    [[ -n "$plugin" ]]      && payload=$(echo "$payload" | jq --arg v "$plugin"      '. + {pluginName: $v}')
    [[ -n "$owner" ]]       && payload=$(echo "$payload" | jq --arg v "$owner"       '. + {owner: $v}')
    [[ -n "$github_repo" ]] && payload=$(echo "$payload" | jq --arg v "$github_repo" '. + {githubRepo: $v}')

    # Call API
    local api_base
    api_base=$(get_api_base)

    print_info "Creating agent..."
    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args
    local response
    # MEDIUM-010: Add timeout to curl
    response=$(curl -s --max-time 30 -X POST "${auth_args[@]}" "${api_base}/api/agents" \
        -H "Content-Type: application/json" \
        -d "$payload")

    # Check for error
    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    # Display result
    local agent_id
    agent_id=$(echo "$response" | jq -r '.agent.id // empty')

    if [[ -n "$agent_id" ]]; then
        print_success "Agent created: $name"
        echo "   ID: $agent_id"
        echo "   Directory: $dir"
        [[ "$force_folder" == true ]] && echo "   Note: Used existing directory (--force-folder)"
        [[ "$no_session" == false ]] && echo "   Session: $name (tmux)"
        [[ ${#program_args[@]} -gt 0 ]] && echo "   Program args: ${program_args[*]}"
    else
        print_error "Failed to create agent"
        echo "$response" | jq . >&2
        return 1
    fi
}

# ============================================================================
# DELETE
# ============================================================================

cmd_delete() {
    local agent=""
    # delete_folder defaults to FALSE to match the server's default. Scenarios
    # (and most user calls) that want the folder removed must pass --delete-folder
    # explicitly — mirrors the UI "Also delete agent folder" checkbox.
    local keep_data=false confirm_delete=false delete_folder=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --confirm) confirm_delete=true; shift ;;
            --delete-folder) delete_folder=true; shift ;;
            --keep-folder) delete_folder=false; shift ;;   # explicit opposite (default)
            --keep-data) keep_data=true; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh delete <agent> --confirm [options]

Options:
  --confirm         Required for deletion (safety flag)
  --delete-folder   Also delete ~/agents/<name>/ (mirrors UI "Also delete agent folder")
  --keep-folder     Keep the folder (default, explicit)
  --keep-data       Don't delete agent data directory (~/.aimaestro/agents/<id>/)

Examples:
  # Delete agent only (folder preserved)
  aimaestro-agent.sh delete my-agent --confirm

  # Delete agent AND its ~/agents/my-agent/ folder
  aimaestro-agent.sh delete my-agent --confirm --delete-folder

  # Delete agent but keep agent data (logs, history)
  aimaestro-agent.sh delete my-agent --confirm --keep-data

  # Delete by agent ID
  aimaestro-agent.sh delete abc123-uuid --confirm

Note (Rule 12): DELETE /api/agents/[id] is a strict route — it requires an
X-Sudo-Token minted from the governance password. Agents cannot earn sudo
tokens; only the human user can, via the password modal in the dashboard
UI. If this command is invoked by an agent (AID_AUTH present but no sudo
token), the API returns "sudo_required" and this CLI prints a guidance
message asking the user to perform the delete via the dashboard.
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name or ID required"; return 1; }

    # Resolve agent
    resolve_agent "$agent" || return 1

    local agent_name="$RESOLVED_ALIAS"
    local agent_id="$RESOLVED_AGENT_ID"

    # Require --confirm for non-interactive mode
    if [[ "$confirm_delete" == false ]]; then
        print_error "Deleting agent '$agent_name' requires --confirm flag"
        print_error "This will:"
        print_error "   - Kill all tmux sessions"
        [[ "$delete_folder" == true ]] && print_error "   - Delete ~/agents/$agent_name/"
        [[ "$keep_data" == false ]] && print_error "   - Delete agent data (~/.aimaestro/agents/$agent_id/)"
        print_error ""
        print_error "Run with --confirm to proceed"
        return 1
    fi

    # Call API
    local api_base
    api_base=$(get_api_base)

    print_info "Deleting agent '$agent_name'..."
    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args

    # Assemble the query string — deleteFolder=true only when the caller
    # asked for it. keepData has its own separate flag.
    local query="?deleteFolder=${delete_folder}"
    [[ "$keep_data" == true ]] && query="${query}&keepData=true"

    local response http_code
    # MEDIUM-010: Add timeout to curl. Capture HTTP status separately so we
    # can detect the "sudo_required" 403 and print a user-facing message.
    response=$(curl -s --max-time 30 -w '\n%{http_code}' -X DELETE "${auth_args[@]}" "${api_base}/api/agents/${agent_id}${query}")
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')

    local error
    error=$(echo "$response" | jq -r '.error // empty')

    # Rule 12 guidance: intercept sudo_required and explain the UI path.
    if [[ "$http_code" = "403" ]] && [[ "$error" = "sudo_required" ]]; then
        print_error "DELETE requires user-driven sudo (Rule 12)."
        print_error ""
        print_error "Agents cannot earn sudo tokens — only the human user can,"
        print_error "via the governance password modal in the dashboard UI. To"
        print_error "complete this operation, ask the user to:"
        print_error "  1. Open the dashboard → click agent '$agent_name'"
        print_error "  2. Profile → Advanced → Danger Zone → Delete Agent"
        [[ "$delete_folder" == true ]] && print_error "  3. Check 'Also delete agent folder'"
        print_error "  4. Enter the governance password when prompted"
        return 1
    fi

    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Agent deleted: $agent_name"
}

# ============================================================================
# UPDATE
# ============================================================================

cmd_update() {
    local agent="" task="" tags="" add_tag="" remove_tag="" model="" args=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -t|--task)
                [[ $# -lt 2 ]] && { print_error "-t/--task requires a value"; return 1; }
                task="$2"; shift 2 ;;
            -m|--model)
                [[ $# -lt 2 ]] && { print_error "-m/--model requires a value"; return 1; }
                model="$2"; shift 2 ;;
            --tags)
                [[ $# -lt 2 ]] && { print_error "--tags requires a value"; return 1; }
                tags="$2"; shift 2 ;;
            --add-tag)
                [[ $# -lt 2 ]] && { print_error "--add-tag requires a value"; return 1; }
                add_tag="$2"; shift 2 ;;
            --remove-tag)
                [[ $# -lt 2 ]] && { print_error "--remove-tag requires a value"; return 1; }
                remove_tag="$2"; shift 2 ;;
            --args)
                [[ $# -lt 2 ]] && { print_error "--args requires a value"; return 1; }
                args="$2"; shift 2 ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh update <agent> [options]

Options:
  -t, --task <desc>      Update task description
  -m, --model <model>    Update AI model
  --args <arguments>     Update program arguments (e.g. "--continue --chrome")
  --tags <t1,t2>         Replace all tags
  --add-tag <tag>        Add a single tag
  --remove-tag <tag>     Remove a single tag
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name or ID required"; return 1; }

    # Validate model format if provided
    if [[ -n "$model" ]]; then
        if [[ ! "$model" =~ ^(claude-)?(sonnet|opus|haiku)(-[0-9]+(-[0-9]+)?(-[0-9]{8})?)?$ ]]; then
            print_error "Invalid model format: $model"
            print_error "Expected format: sonnet, opus, haiku, or claude-{family}-{version}"
            return 1
        fi
    fi

    resolve_agent "$agent" || return 1

    # Build update payload
    local payload="{}"

    [[ -n "$task" ]] && payload=$(echo "$payload" | jq --arg t "$task" '. + {taskDescription: $t}')
    [[ -n "$model" ]] && payload=$(echo "$payload" | jq --arg m "$model" '. + {model: $m}')
    [[ -n "$tags" ]] && payload=$(echo "$payload" | jq --arg t "$tags" '. + {tags: ($t | split(","))}')
    [[ -n "$args" ]] && payload=$(echo "$payload" | jq --arg a "$args" '. + {programArgs: $a}')

    # Handle add/remove tag (need to get current tags first)
    if [[ -n "$add_tag" ]] || [[ -n "$remove_tag" ]]; then
        local current_tags
        current_tags=$(get_agent_data "$RESOLVED_AGENT_ID" | jq -r '.agent.tags // []')

        if [[ -n "$add_tag" ]]; then
            current_tags=$(echo "$current_tags" | jq --arg t "$add_tag" '. + [$t] | unique')
        fi
        if [[ -n "$remove_tag" ]]; then
            current_tags=$(echo "$current_tags" | jq --arg t "$remove_tag" 'map(select(. != $t))')
        fi

        payload=$(echo "$payload" | jq --argjson tags "$current_tags" '. + {tags: $tags}')
    fi

    # Call API
    local api_base
    api_base=$(get_api_base)

    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args

    local response http_code
    # MEDIUM-010: Add timeout to curl. Capture HTTP status separately so we
    # can detect the "sudo_required" 403 and print user-facing guidance.
    # PROP #1: PATCH /api/agents/{id} now sudo-requires ALL Change*-owned
    # fields (name, workingDirectory, avatar, programArgs, program,
    # governanceTitle, githubRepo) — any update through cmd_update with
    # one of these fields will trip this gate when invoked by an agent
    # (agents cannot earn sudo tokens per Rule 12).
    response=$(curl -s --max-time 30 -w '\n%{http_code}' -X PATCH "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}" \
        -H "Content-Type: application/json" \
        -d "$payload")
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')

    local error
    error=$(echo "$response" | jq -r '.error // empty')

    # Rule 12 guidance: intercept sudo_required and explain the UI path.
    if [[ "$http_code" = "403" ]] && [[ "$error" = "sudo_required" ]]; then
        print_error "UPDATE requires user-driven sudo (Rule 12)."
        print_error ""
        print_error "Agents cannot earn sudo tokens — only the human user can,"
        print_error "via the governance password modal in the dashboard UI. To"
        print_error "complete this agent update, ask the user to:"
        print_error "  1. Open the dashboard → click agent '$RESOLVED_ALIAS'"
        print_error "  2. Profile → Overview/Advanced → edit the desired field"
        print_error "  3. Enter the governance password when prompted"
        return 1
    fi

    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    print_success "Agent updated: $RESOLVED_ALIAS"
}

# ============================================================================
# RENAME
# ============================================================================

cmd_rename() {
    local old_name="" new_name=""
    local rename_session=false rename_folder=false confirm_rename=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --rename-session) rename_session=true; shift ;;
            --rename-folder) rename_folder=true; shift ;;
            -y|--yes) confirm_rename=true; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh rename <old-name> <new-name> --yes [options]

Options:
  --rename-session    Also rename tmux session
  --rename-folder     Also rename project folder
  --yes, -y           Required for rename (safety flag)

Examples:
  # Rename agent (requires --yes for safety)
  aimaestro-agent.sh rename old-name new-name --yes

  # Rename agent and tmux session
  aimaestro-agent.sh rename old-name new-name --yes --rename-session

  # Rename agent, session, and project folder
  aimaestro-agent.sh rename old-name new-name --yes --rename-session --rename-folder
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *)
                if [[ -z "$old_name" ]]; then old_name="$1"
                elif [[ -z "$new_name" ]]; then new_name="$1"
                fi
                shift ;;
        esac
    done

    [[ -z "$old_name" ]] && { print_error "Old name required"; return 1; }
    [[ -z "$new_name" ]] && { print_error "New name required"; return 1; }

    validate_agent_name "$new_name" || return 1

    resolve_agent "$old_name" || return 1

    # Check for name collision with new name
    if check_agent_exists "$new_name"; then
        print_error "Agent with name '$new_name' already exists"
        print_error "Use a different name"
        return 1
    fi

    # Require --yes for non-interactive mode
    if [[ "$confirm_rename" == false ]]; then
        print_error "Renaming agent '$RESOLVED_ALIAS' to '$new_name' requires --yes flag"
        print_error "Run with --yes to proceed"
        return 1
    fi

    # Update name via API
    local api_base
    api_base=$(get_api_base)

    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args

    local payload
    payload=$(jq -n --arg name "$new_name" '{name: $name}')

    local response http_code
    # MEDIUM-010: Add timeout to curl. Capture HTTP status separately so we
    # can detect the "sudo_required" 403 and print user-facing guidance.
    # PROP #1: agent rename is a sudo-required Change*-owned field now —
    # renaming hijacks AMP identity, so agents must not rename without
    # explicit human approval.
    response=$(curl -s --max-time 30 -w '\n%{http_code}' -X PATCH "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}" \
        -H "Content-Type: application/json" \
        -d "$payload")
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')

    local error
    error=$(echo "$response" | jq -r '.error // empty')

    # Rule 12 guidance: intercept sudo_required and explain the UI path.
    if [[ "$http_code" = "403" ]] && [[ "$error" = "sudo_required" ]]; then
        print_error "RENAME requires user-driven sudo (Rule 12)."
        print_error ""
        print_error "Agents cannot earn sudo tokens — renaming an agent hijacks"
        print_error "its AMP identity (other agents address it by name), so the"
        print_error "human user must re-authenticate. To complete the rename:"
        print_error "  1. Open the dashboard → click agent '$old_name'"
        print_error "  2. Profile → Overview → click the name field → enter '$new_name'"
        print_error "  3. Enter the governance password when prompted"
        return 1
    fi

    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    # Rename tmux session if requested
    if [[ "$rename_session" == true ]]; then
        local session_name
        session_name=$(get_agent_session_name "$RESOLVED_AGENT_ID")
        # CRITICAL-2: Validate tmux session names before use to prevent command injection
        if [[ -n "$session_name" ]] && validate_tmux_session_name "$session_name"; then
            # Use -- to separate options from arguments
            if tmux has-session -t -- "$session_name" 2>/dev/null; then
                tmux rename-session -t -- "$session_name" "$new_name"
                print_info "Renamed tmux session: $session_name -> $new_name"
            fi
        elif [[ -n "$session_name" ]]; then
            print_warning "Invalid tmux session name format, skipping session rename"
        fi
    fi

    # Rename folder if requested
    if [[ "$rename_folder" == true ]]; then
        local old_dir
        old_dir=$(get_agent_working_dir "$RESOLVED_AGENT_ID")
        if [[ -n "$old_dir" ]] && [[ -d "$old_dir" ]]; then
            local parent_dir
            parent_dir=$(dirname "$old_dir")
            local new_dir="${parent_dir}/${new_name}"

            # MEDIUM-001: Use mv -n (no-clobber) to avoid TOCTOU race
            if ! mv -n "$old_dir" "$new_dir" 2>/dev/null; then
                print_warning "Cannot rename folder (target may exist): $new_dir"
            else
                # HIGH-002: Use jq for JSON construction to avoid injection.
                # PROP #1: workingDirectory is now a strict Change* field;
                # this PATCH requires sudo. Capture HTTP status so we can
                # roll back the mv if the API refuses (otherwise the folder
                # is in new_dir but the registry still points at old_dir —
                # a far worse state than "rename refused cleanly").
                local dir_payload dir_response dir_http_code
                dir_payload=$(jq -n --arg d "$new_dir" '{workingDirectory: $d}')
                dir_response=$(curl -s --max-time 30 -w '\n%{http_code}' -X PATCH "${auth_args[@]}" "${api_base}/api/agents/${RESOLVED_AGENT_ID}" \
                    -H "Content-Type: application/json" \
                    -d "$dir_payload")
                dir_http_code=$(echo "$dir_response" | tail -n1)
                if [[ "$dir_http_code" = "403" ]]; then
                    # Roll back — the folder moved on disk but the registry
                    # wasn't updated. Put it back so the agent still works.
                    mv -n "$new_dir" "$old_dir" 2>/dev/null || true
                    print_warning "Folder rename refused (sudo required). Restored original path."
                    print_warning "To rename via UI: Profile → Advanced → change working directory."
                elif [[ "$dir_http_code" -ge 400 ]]; then
                    mv -n "$new_dir" "$old_dir" 2>/dev/null || true
                    print_warning "Folder rename failed (HTTP $dir_http_code). Restored original path."
                else
                    print_info "Renamed folder: $old_dir -> $new_dir"
                fi
            fi
        fi
    fi

    print_success "Agent renamed: $RESOLVED_ALIAS -> $new_name"
}

# ============================================================================
# EXPORT / IMPORT
# ============================================================================

cmd_export() {
    local agent="" output="" include_data=false include_folder=false

    while [[ $# -gt 0 ]]; do
        # shellcheck disable=SC2034  # TODO(TRDD-5e0638ed): --include-data/--include-folder parsed but not yet honored
        case "$1" in
            -o|--output)
                [[ $# -lt 2 ]] && { print_error "-o/--output requires a value"; return 1; }
                output="$2"; shift 2 ;;
            --include-data) include_data=true; shift ;;
            --include-folder) include_folder=true; shift ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh export <agent> [options]

Options:
  -o, --output <file>    Output file (default: <name>.agent.json)
  --include-data         Include agent data directory (not implemented)
  --include-folder       Include project folder (not implemented)
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) agent="$1"; shift ;;
        esac
    done

    [[ -z "$agent" ]] && { print_error "Agent name required"; return 1; }

    resolve_agent "$agent" || return 1

    [[ -z "$output" ]] && output="${RESOLVED_ALIAS}.agent.json"

    # Get agent data
    local agent_data
    agent_data=$(get_agent_data "$RESOLVED_AGENT_ID")

    if [[ -z "$agent_data" ]]; then
        print_error "Failed to fetch agent data"
        return 1
    fi

    # Create export JSON
    local export_json
    export_json=$(create_export_json "$agent_data")

    # MEDIUM-1: Use atomic write pattern (write to temp, then rename)
    # This prevents data corruption on interrupted writes
    local tmp_output
    tmp_output=$(mktemp "${output}.XXXXXX") || {
        print_error "Failed to create temporary file"
        return 1
    }
    # Register for cleanup in case of early exit
    register_temp_file "$tmp_output"

    if ! echo "$export_json" > "$tmp_output"; then
        print_error "Failed to write to temporary file"
        rm -f "$tmp_output" 2>/dev/null
        return 1
    fi

    # Atomic rename - this either fully succeeds or fails
    if ! mv "$tmp_output" "$output"; then
        print_error "Failed to write to: $output"
        rm -f "$tmp_output" 2>/dev/null
        return 1
    fi
    print_success "Exported to: $output"
}

cmd_import() {
    local file="" new_name="" new_dir=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name)
                [[ $# -lt 2 ]] && { print_error "--name requires a value"; return 1; }
                new_name="$2"; shift 2 ;;
            --dir)
                [[ $# -lt 2 ]] && { print_error "--dir requires a value"; return 1; }
                new_dir="$2"; shift 2 ;;
            -h|--help)
                cat << 'HELP'
Usage: aimaestro-agent.sh import <file> [options]

Options:
  --name <new-name>    Override agent name
  --dir <path>         Override working directory
HELP
                return 0 ;;
            -*) print_error "Unknown option: $1"; return 1 ;;
            *) file="$1"; shift ;;
        esac
    done

    [[ -z "$file" ]] && { print_error "Import file required"; return 1; }

    validate_import_file "$file" || return 1

    # MEDIUM-5: JSON schema validation for import files
    # Validate required fields and types to prevent JSON injection/corruption
    # We only care about the exit status (jq -e returns 1 if result is false/null)
    if ! jq -e '
        .agent
        | (type == "object") and
          (has("name")) and
          (.name | type == "string") and
          (.name | length > 0) and
          (.name | length <= 64) and
          (.name | test("^[a-zA-Z0-9_-]+$")) and
          (if has("workingDirectory") then (.workingDirectory | type == "string") else true end) and
          (if has("program") then (.program | type == "string") else true end) and
          (if has("model") then (.model | type == "string" or . == null) else true end) and
          (if has("tags") then (.tags | type == "array") else true end)
    ' "$file" >/dev/null 2>&1; then
        print_error "Import file validation failed: invalid schema"
        print_error "Required: .agent.name (string, alphanumeric+hyphens+underscores, 1-64 chars)"
        return 1
    fi

    # Read agent data
    local agent_data
    agent_data=$(jq -e '.agent' "$file") || {
        print_error "Failed to extract agent data from import file"
        return 1
    }

    # Override fields if specified
    [[ -n "$new_name" ]] && agent_data=$(echo "$agent_data" | jq --arg n "$new_name" '.name = $n')
    [[ -n "$new_dir" ]] && agent_data=$(echo "$agent_data" | jq --arg d "$new_dir" '.workingDirectory = $d')

    # Remove fields that shouldn't be imported
    agent_data=$(echo "$agent_data" | jq 'del(.id, .createdAt, .sessions, .status)')

    # Call API to create
    local api_base
    api_base=$(get_api_base)

    # SCEN-022 BUG-001 fix (P0): inject AID_AUTH for agent callers
    local -a auth_args=()
    _build_auth_args auth_args

    print_info "Importing agent..."
    local response
    response=$(curl -s --max-time 30 -X POST "${auth_args[@]}" "${api_base}/api/agents" \
        -H "Content-Type: application/json" \
        -d "$agent_data")

    local error
    error=$(echo "$response" | jq -r '.error // empty')
    if [[ -n "$error" ]]; then
        print_error "$error"
        return 1
    fi

    local imported_name
    imported_name=$(echo "$response" | jq -r '.agent.name')
    print_success "Agent imported: $imported_name"
}
