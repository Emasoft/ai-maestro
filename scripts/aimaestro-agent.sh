#!/usr/bin/env bash
# shellcheck disable=SC2034  # FORCE variable is used by confirm() in agent-helper.sh
# AI Maestro Agent Management CLI
# Manage agents: create, delete, hibernate, wake, configure plugins, and more
#
# Usage: aimaestro-agent.sh <command> [options]
#
# Commands:
#   list        List all agents
#   show        Show agent details
#   config      Print an agent's consolidated config (teams, repo, docker, tasks, AID)
#   resolve     Resolve an agent (by name or --cwd) to its tmux session name
#   create      Create a new agent
#   delete      Delete an agent
#   update      Update agent properties
#   rename      Rename an agent
#   session     Manage agent sessions
#   hibernate   Hibernate an agent (stop session, preserve state)
#   wake        Wake a hibernated agent
#   restart     Restart an agent (hibernate + wake with verification)
#   skill       Manage agent skills
#   plugin      Manage Claude Code plugins for an agent
#   export      Export agent to file
#   import      Import agent from file
#   presence    Print the human user's presence (last input + idle window)
#   probe       Aggregate status + block-state + hook chat-state for one agent
#   help        Show this help
#
# Version: Sync with bump-version.sh - currently v1.0.1

set -euo pipefail

# Global flags
FORCE=false

# ============================================================================
# SOURCE MODULES
# Sourcing order matters: helper -> core -> commands/session/skill/plugin
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Helper function to source a module from SCRIPT_DIR or fallback to ~/.local/bin
_source_module() {
    local module="$1"
    if [[ -f "${SCRIPT_DIR}/${module}" ]]; then
        # shellcheck source=/dev/null
        if ! source "${SCRIPT_DIR}/${module}"; then
            echo "Error: Failed to source ${module}" >&2
            exit 1
        fi
    elif [[ -f "${HOME}/.local/bin/${module}" ]]; then
        # shellcheck source=/dev/null
        if ! source "${HOME}/.local/bin/${module}"; then
            echo "Error: Failed to source ${module} from ~/.local/bin" >&2
            exit 1
        fi
    else
        echo "Error: ${module} not found in ${SCRIPT_DIR} or ~/.local/bin" >&2
        exit 1
    fi
}

# 1. Helper: colors, print_*, resolve_agent, get_api_base
_source_module "agent-helper.sh"

# 2. Core: shared infra (temp files, security, validation, JSON editing, Claude CLI helpers)
_source_module "agent-core.sh"

# 3. Command modules (depend on helper + core)
_source_module "agent-commands.sh"
_source_module "agent-session.sh"
_source_module "agent-skill.sh"
_source_module "agent-plugin.sh"

# ============================================================================
# SETUP
# ============================================================================

# Check dependencies (defined in agent-core.sh)
check_dependencies

# Set up cleanup trap (cleanup() is defined in agent-core.sh)
trap cleanup EXIT INT TERM

# ============================================================================
# DISPATCH — ONE verb list, consulted twice
# ============================================================================
#
# `check` answers "is this a verb?" without running anything; `run` executes it.
# Both read the SAME case arms, so adding a verb is one line and the two can
# never disagree about what exists.
#
# WHY THIS IS SPLIT AT ALL (TRDD-T3FXA0Y0, ai-maestro#121). Recognising a verb is
# a LOCAL, OFFLINE determination — `aimaestro-agent.sh nonsense` is wrong on a
# host with no network at all, and this script already knows it. With
# check_api_running first, that caller was told "the API is not reachable",
# which is FALSE and aims them at the wrong thing: they go debug a server that
# has nothing to do with their typo. It is the same defect as `--help` exiting 1
# (fixed above), in its third instance.
#
# THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE. A second `case` above the gate
# listing the verbs is two enumerations of one fact, and they drift the first
# time someone adds a verb to only one of them — at which point a real verb is
# rejected as unknown, or an unknown one reaches the gate and gets the old
# misleading message back. The mode parameter is what keeps it to one list.
#
# Each arm is `[ "$mode" != run ] || cmd_x "$@"` rather than `&& return 0`,
# because `set -e` is on: a bare `cond && return 0` whose condition FAILS makes
# the statement's status 1 and kills the shell. The `||` form succeeds in every
# non-run mode by short-circuit, and in run mode carries the command's own status.
#
# The guard tests `!= run`, NOT `= check`, and that polarity is load-bearing: with
# `= check` a third mode falls through to EXECUTING the command, so adding
# `validate` would have made `dispatch validate list` actually list — a validation
# pass that performs the operation it was meant to pre-screen. A mode nobody wired
# up must do nothing; default-to-inert is the only safe direction here.
#
# A THIRD MODE, `validate`, runs a verb's LOCAL argument grammar before the gate — same
# reasoning one level down: `list --status hibernated` is invalid on a host with no network,
# and the CLI already knows it (agent-commands.sh::validate_status_value). Most verbs have no
# local grammar and simply return 0; a verb that grows one adds its validator on its own arm,
# so the verb list still exists exactly once.
dispatch() {
    local mode="$1"; shift
    local verb="$1"; shift
    case "$verb" in
        list)         case "$mode" in
                          check)    return 0 ;;
                          validate) validate_list_args "$@" ;;
                          *)        cmd_list "$@" ;;
                      esac ;;
        show)         [ "$mode" != run ] || cmd_show "$@" ;;
        config)       [ "$mode" != run ] || cmd_config "$@" ;;
        resolve)      [ "$mode" != run ] || cmd_resolve "$@" ;;
        create)       [ "$mode" != run ] || cmd_create "$@" ;;
        delete)       [ "$mode" != run ] || cmd_delete "$@" ;;
        update)       [ "$mode" != run ] || cmd_update "$@" ;;
        rename)       [ "$mode" != run ] || cmd_rename "$@" ;;
        session)      [ "$mode" != run ] || cmd_session "$@" ;;
        hibernate)    [ "$mode" != run ] || cmd_hibernate "$@" ;;
        wake)         [ "$mode" != run ] || cmd_wake "$@" ;;
        restart)      [ "$mode" != run ] || cmd_restart "$@" ;;
        skill)        [ "$mode" != run ] || cmd_skill "$@" ;;
        plugin)       [ "$mode" != run ] || cmd_plugin "$@" ;;
        export)       [ "$mode" != run ] || cmd_export "$@" ;;
        import)       [ "$mode" != run ] || cmd_import "$@" ;;
        presence)     [ "$mode" != run ] || cmd_presence "$@" ;;
        probe)        [ "$mode" != run ] || cmd_probe "$@" ;;
        hibernation)  [ "$mode" != run ] || cmd_hibernation "$@" ;;
        subconscious) [ "$mode" != run ] || cmd_subconscious "$@" ;;
        # help / --version are dispatched in main BEFORE the gate — deliberately
        # NOT repeated here, so there is one dispatch site per verb.
        #
        # In `run` mode this arm is unreachable: main only reaches `dispatch run`
        # after `dispatch check` returned 0 on the same argv. It is kept as a
        # hard failure rather than a silent 0 so that if the two calls ever DO
        # diverge, the script exits instead of quietly doing nothing.
        *) return 1 ;;
    esac
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    # HELP AND VERSION ARE LOCAL, OFFLINE OPERATIONS — they must be answerable with
    # no server, no network and no credential, so they are dispatched BEFORE
    # check_api_running (TRDD-T3FXA0Y0, ai-maestro#121).
    #
    # Two defects in one line, and the exit code was the lesser of them. With the
    # API gate first, `--help` exited 1 on a perfectly successful run — which is
    # #121's exact complaint, and it trains every caller to stop branching on the
    # exit status. Worse: an unauthenticated caller got the 401 diagnostic INSTEAD
    # of the help text, so the CLI became undiscoverable at precisely the moment
    # someone needed it — a new agent, or a human whose AID_AUTH is not yet set,
    # asking the one question the tool can always answer.
    #
    # Ordering IS the fix: nothing below this point can be reached without the
    # server, and nothing above it needs one.
    case "${1:-help}" in
        help|--help|-h) cmd_help; return 0 ;;
        --version|-v)   echo "aimaestro-agent.sh v1.0.1"; return 0 ;;
    esac

    # RECOGNITION IS LOCAL — an unknown verb is answerable with no server, so it
    # is answered BEFORE the gate. Reaching here means $# >= 1: the case above
    # returns on the no-argument default.
    dispatch check "$@" || {
        print_error "Unknown command: $1"
        echo ""
        cmd_help
        exit 1
    }

    # A verb's LOCAL argument grammar is answerable offline too, so it is answered
    # here — one level down from recognition, same reasoning. `--status hibernated`
    # cannot match on any host, network or not.
    dispatch validate "$@" || exit 1

    # Everything past this point genuinely needs the server.
    check_api_running || exit 1

    dispatch run "$@"
}

main "$@"
