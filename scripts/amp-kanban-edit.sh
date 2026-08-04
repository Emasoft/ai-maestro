#!/usr/bin/env bash
# =============================================================================
# AMP Kanban Edit - Update any field of a kanban task
# =============================================================================
#
# Full-field edit of a task on the team kanban board via AI Maestro API.
# Resolves team ID from the agent's registration unless --team is provided.
#
# amp-kanban-move.sh is the narrow verb (status only). THIS is the general one:
# every field the task PUT accepts can be set here.
#
# Two setters, because task fields are not all strings:
#   --set key=value        the value is sent as a JSON string
#   --set-json key=<json>  the value is sent as raw JSON (numbers, arrays, null)
#
# String fields:  subject description status taskType externalRef
#                 externalProjectRef previousStatus acceptanceCriteria
#                 handoffDoc prUrl reviewResult severity effort parentTask
#                 supersededBy releaseVia lastTestResult publishedVersion
#                 liveSince dueDate assigneeAgentId
# JSON  fields:   priority (number) labels blockedBy npt eht supersedes
#                 relevantRules implementationCommits attachments (arrays)
#
# The server whitelists field names; an unknown key is ignored, not an error.
#
# Usage:
#   amp-kanban-edit.sh <task-id> --set key=value [--set-json key=<json>] ... [options]
#
# Examples:
#   amp-kanban-edit.sh abc-123 --set subject="Fix the login redirect"
#   amp-kanban-edit.sh abc-123 --set status=ai_review --set-json priority=1
#   amp-kanban-edit.sh abc-123 --set-json 'labels=["bug","p0"]'
#   amp-kanban-edit.sh abc-123 --set-json 'blockedBy=[]' --set status=dev
#
# =============================================================================

set -eo pipefail

# Pre-source: extract --id to set agent identity before helper resolves it
_amp_prev=""
for _amp_arg in "$@"; do
    if [ "$_amp_prev" = "--id" ]; then
        export CLAUDE_AGENT_ID="$_amp_arg"
        break
    fi
    _amp_prev="$_amp_arg"
done
unset _amp_prev _amp_arg

# Source helper functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/amp-helper.sh"

# =============================================================================
# Arguments
# =============================================================================
TASK_ID=""
TEAM_ID=""
BODY="{}"

show_help() {
    echo "Usage: amp-kanban-edit.sh <task-id> --set key=value [...] [options]"
    echo ""
    echo "Update any field of a kanban task."
    echo ""
    echo "Arguments:"
    echo "  task-id    Task UUID or external reference"
    echo ""
    echo "Setters (at least one required):"
    echo "  --set key=value        Send the value as a JSON string"
    echo "  --set-json key=<json>  Send the value as raw JSON (number, array, null)"
    echo ""
    echo "Options:"
    echo "  --team TEAM_ID    Team UUID (auto-detected from agent if omitted)"
    echo "  --id UUID         Operate as this agent (UUID from config.json)"
    echo "  --help, -h        Show this help"
    echo ""
    echo "Examples:"
    echo "  amp-kanban-edit.sh abc-123 --set subject=\"Fix the login redirect\""
    echo "  amp-kanban-edit.sh abc-123 --set status=ai_review --set-json priority=1"
    echo "  amp-kanban-edit.sh abc-123 --set-json 'labels=[\"bug\",\"p0\"]'"
}

# Split "key=value" on the FIRST '=' only — a value may legitimately contain '='
# (a URL query string, a base64 pad). Returns via the KEY / VAL globals.
_split_pair() {
    local pair="$1" flag="$2"
    if [[ "$pair" != *=* ]]; then
        echo "Error: ${flag} expects key=value, got '${pair}'" >&2
        exit 1
    fi
    KEY="${pair%%=*}"
    VAL="${pair#*=}"
    if [ -z "$KEY" ]; then
        echo "Error: ${flag} key must not be empty" >&2
        exit 1
    fi
}

# Parse arguments
POSITIONAL=()
SETTER_COUNT=0
while [[ $# -gt 0 ]]; do
    case $1 in
        --set)
            _split_pair "$2" "--set"
            BODY=$(echo "$BODY" | jq -c --arg k "$KEY" --arg v "$VAL" '. + {($k): $v}')
            SETTER_COUNT=$((SETTER_COUNT + 1))
            shift 2
            ;;
        --set-json)
            _split_pair "$2" "--set-json"
            # Validate before building the body: a malformed value must fail here
            # with the offending key named, not silently become a `null` field.
            if ! echo "$VAL" | jq -e . >/dev/null 2>&1; then
                echo "Error: --set-json value for '${KEY}' is not valid JSON: ${VAL}" >&2
                exit 1
            fi
            BODY=$(echo "$BODY" | jq -c --arg k "$KEY" --argjson v "$VAL" '. + {($k): $v}')
            SETTER_COUNT=$((SETTER_COUNT + 1))
            shift 2
            ;;
        --team)
            TEAM_ID="$2"
            shift 2
            ;;
        --id)
            shift 2  # Already handled in pre-source parsing
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Run 'amp-kanban-edit.sh --help' for usage." >&2
            exit 1
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

if [ ${#POSITIONAL[@]} -lt 1 ]; then
    echo "Error: Missing required argument <task-id>." >&2
    echo "" >&2
    show_help
    exit 1
fi

if [ "$SETTER_COUNT" -eq 0 ]; then
    echo "Error: at least one --set or --set-json is required." >&2
    echo "" >&2
    show_help
    exit 1
fi

TASK_ID="${POSITIONAL[0]}"

API="${AIMAESTRO_API:-http://localhost:23000}"

# =============================================================================
# Resolve team ID from agent's registration if not provided
# =============================================================================
if [ -z "$TEAM_ID" ]; then
    AGENT_UUID="${CLAUDE_AGENT_ID:-}"
    if [ -z "$AGENT_UUID" ] && [ -f "${AMP_CONFIG:-}" ]; then
        AGENT_UUID=$(jq -r '.agent.id // .id // empty' "$AMP_CONFIG" 2>/dev/null)
    fi

    if [ -n "$AGENT_UUID" ]; then
        TEAM_ID=$(curl -sf "$API/api/agents/$AGENT_UUID" 2>/dev/null | jq -r '.agent.teamId // empty' 2>/dev/null) || true
    fi

    if [ -z "$TEAM_ID" ]; then
        echo "Error: Could not determine team ID. Use --team <team-id> to specify." >&2
        exit 1
    fi
fi

# =============================================================================
# Apply the edit
# =============================================================================
# `|| true` is LOAD-BEARING (TRDD-2U56TLBX). Under `set -e` an assignment whose command
# substitution fails takes the script down with that command's exit status, so an unreachable
# server (curl exit 7) killed it HERE and the "❌ Failed to edit task" branch below never
# ran — a bare exit 7 with no diagnostic, for an edit that never landed. curl still writes
# `000` through `-w`. Guard only: the branch already ends in `exit 1`.
RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout 5 --max-time 15 \
    -X PUT "$API/api/teams/$TEAM_ID/tasks/$TASK_ID" \
    -H "Content-Type: application/json" \
    -d "$BODY") || true

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "✅ Task updated (${SETTER_COUNT} field(s))"
    echo ""
    echo "$RESP_BODY" | jq '.'
else
    echo "❌ Failed to edit task (HTTP ${HTTP_CODE})" >&2
    ERROR_MSG=$(echo "$RESP_BODY" | jq -r '.error // "Unknown error"' 2>/dev/null)
    if [ -n "$ERROR_MSG" ] && [ "$ERROR_MSG" != "null" ]; then
        echo "   Error: ${ERROR_MSG}" >&2
    fi
    exit 1
fi
