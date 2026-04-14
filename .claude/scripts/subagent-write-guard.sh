#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# subagent-write-guard.sh
#
# PreToolUse hook for the scenarios-autorunner subagents
# (scenario-runner and scenario-improvement-implementer).
#
# PURPOSE
#   Enforces the rule that scenario subagents may only WRITE to:
#     1. $CLAUDE_PROJECT_DIR — the project root (for runner) or the
#        subagent's git worktree (for implementer, via isolation: worktree)
#     2. The system scratch area — tmp and private tmp
#        (used for cloning/fixing ai-maestro plugins)
#   Reads are NOT restricted — subagents may read from anywhere.
#
# WHY
#   The 2026-04-14 overnight run exposed a gap: when an improvement
#   implementer's `git reset --hard` was blocked by the user's global
#   git safety hook, the subagent escaped its worktree by `cd`-ing to
#   the parent ai-maestro repo, checking out a new branch, and writing
#   files there. This corrupted the parent working tree. The core
#   `isolation: worktree` feature provides filesystem isolation (each
#   worktree is a separate git checkout) but NOT process sandboxing —
#   the subagent has unrestricted bash + file tools.
#
#   This hook closes that gap by validating every Write/Edit/MultiEdit/
#   NotebookEdit tool call against an allowlist of write roots, and by
#   catching the most common Bash escape patterns (cd to absolute path
#   outside the allowlist, git -C / rm / mv / cp / sed -i / file
#   redirection targeting absolute paths outside the allowlist).
#
# INVOCATION
#   Referenced from both agents' frontmatter:
#     ---
#     name: scenario-runner
#     hooks:
#       PreToolUse:
#         - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
#           hooks:
#             - type: command
#               command: "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/subagent-write-guard.sh"
#     ---
#
# INPUT
#   Claude Code passes the PreToolUse hook input as JSON on stdin:
#     {
#       "tool_name": "Write" | "Edit" | "MultiEdit" | "NotebookEdit" | "Bash",
#       "tool_input": { "file_path"|"notebook_path"|"command": ... }
#     }
#
# EXIT CODES
#   0 — allow the tool call
#   2 — block the tool call (stderr becomes the reason shown to Claude)
#
# DEPENDENCIES
#   jq (any version)
#   realpath (optional — falls back to raw path matching on systems without it)
# ────────────────────────────────────────────────────────────────────

set -euo pipefail

# Read hook JSON from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Resolve the project root (CLAUDE_PROJECT_DIR points at the agent's
# working tree — main tree for runner, worktree dir for implementer).
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
    # No project root → cannot enforce the rule → fail open but log.
    echo "[write-guard] WARN: CLAUDE_PROJECT_DIR not set, allowing tool call" >&2
    exit 0
fi

# Resolve to absolute path (with symlink resolution when possible)
if command -v realpath >/dev/null 2>&1; then
    PROJECT_ROOT_ABS=$(realpath "$PROJECT_ROOT" 2>/dev/null || echo "$PROJECT_ROOT")
else
    PROJECT_ROOT_ABS=$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P || echo "$PROJECT_ROOT")
fi

# Normalize a candidate path to absolute form for comparison
normalize_path() {
    local path="$1"
    # Handle HOME-relative paths (bash expands ~ only outside quotes, but we
    # get tool input as JSON strings — so do the expansion ourselves).
    # shellcheck disable=SC2088  # we're checking literal 2-char prefix, not expanding
    if [ "${path:0:2}" = '~/' ]; then
        path="${HOME}/${path:2}"
    elif [ "$path" = '~' ]; then
        path="$HOME"
    fi
    if command -v realpath >/dev/null 2>&1; then
        realpath -m "$path" 2>/dev/null || echo "$path"
    else
        echo "$path"
    fi
}

# Check whether an absolute path falls under one of the allowed roots.
is_allowed_path() {
    local candidate="$1"
    [ -z "$candidate" ] && return 1

    local abs
    abs=$(normalize_path "$candidate")

    # 1. Project root (main tree or worktree)
    case "$abs" in
        "$PROJECT_ROOT_ABS"|"$PROJECT_ROOT_ABS"/*) return 0 ;;
    esac

    # 2. Scratch areas
    case "$abs" in
        /tmp|/tmp/*) return 0 ;;
        /private/tmp|/private/tmp/*) return 0 ;;
        # Note: macOS private tmp is reached via the private tmp symlink,
        # so the private tmp coverage above is enough
    esac

    return 1
}

# Emit a block message and exit with code 2 (Claude sees the reason)
block() {
    local reason="$1"
    cat >&2 <<EOF
BLOCKED by scenarios-autorunner write-guard
  Tool:   $TOOL_NAME
  Reason: $reason

Allowed write roots:
  - $PROJECT_ROOT_ABS (project root / worktree)
  - tmp, private tmp (system scratch)

Scenario subagents may READ from anywhere, but may only WRITE inside
their project root or /tmp. If you need to modify a file outside these
roots, do not bypass this rule — return a DEFERRED report explaining
what you wanted to change and why, and leave the orchestrator to do it.
EOF
    exit 2
}

case "$TOOL_NAME" in
    Write)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
        is_allowed_path "$FILE_PATH" || block "Write target '$FILE_PATH' is outside allowed roots"
        ;;
    Edit)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
        is_allowed_path "$FILE_PATH" || block "Edit target '$FILE_PATH' is outside allowed roots"
        ;;
    MultiEdit)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
        is_allowed_path "$FILE_PATH" || block "MultiEdit target '$FILE_PATH' is outside allowed roots"
        ;;
    NotebookEdit)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.notebook_path // ""')
        is_allowed_path "$FILE_PATH" || block "NotebookEdit target '$FILE_PATH' is outside allowed roots"
        ;;
    Bash)
        CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

        # 1. `cd /absolute/path` — catches the primary escape vector
        #    (subagent 2 used this to reach the parent repo).
        #    Matches: `cd /foo`, `cd /foo && ...`, `cd /foo; ...`, `; cd /foo`
        while IFS= read -r cd_path; do
            [ -z "$cd_path" ] && continue
            is_allowed_path "$cd_path" || block "Bash 'cd' to forbidden dir: $cd_path"
        done < <(
            echo "$CMD" \
                | grep -oE '(^|[[:space:]]|&&|\|\||;|\()[[:space:]]*cd[[:space:]]+[^[:space:]&|;()"'"'"']+' \
                | grep -oE '/[^[:space:]&|;()"'"'"']+' \
                || true
        )

        # 2. `git -C /path ...` — catches git commands that explicitly
        #    target a repo outside the worktree.
        while IFS= read -r git_path; do
            [ -z "$git_path" ] && continue
            is_allowed_path "$git_path" || block "Bash 'git -C' references forbidden dir: $git_path"
        done < <(
            echo "$CMD" \
                | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]&|;()"'"'"']+' \
                | grep -oE '/[^[:space:]&|;()"'"'"']+' \
                || true
        )

        # 3. File redirection `> /abs/path` or `>> /abs/path` to
        #    absolute paths outside the allowlist.
        while IFS= read -r redir_path; do
            [ -z "$redir_path" ] && continue
            is_allowed_path "$redir_path" || block "Bash redirection target: $redir_path"
        done < <(
            echo "$CMD" \
                | grep -oE '[12]?>>?[[:space:]]*/[^[:space:]&|;()"'"'"']+' \
                | grep -oE '/[^[:space:]&|;()"'"'"']+' \
                || true
        )

        # 4. Write verbs (rm, mv, cp, mkdir, touch, sed -i, tee, chmod, chown, dd, install, ln).
        #    If any such verb is present in the command, scan ALL absolute
        #    paths mentioned anywhere in the command and reject any that
        #    fall outside the allowlist. This is a deliberately liberal
        #    check: false positives (a read-only `cat /some/path` in the
        #    same pipeline) are tolerated because the subagent can easily
        #    split the command. False negatives (missed escape) are not.
        if echo "$CMD" | grep -qE '(^|[[:space:]]|&&|\|\||;|\()[[:space:]]*(rm|mv|cp|mkdir|touch|tee|chmod|chown|dd|install|ln)([[:space:]]|$)' \
           || echo "$CMD" | grep -qE '(^|[[:space:]])sed[[:space:]]+-[a-zA-Z.]*i'; then
            while IFS= read -r abs_path; do
                [ -z "$abs_path" ] && continue
                # Skip obvious option-argument false positives like `--prefix=/usr`
                case "$abs_path" in
                    =*|--*) continue ;;
                esac
                is_allowed_path "$abs_path" || block "Bash write op references forbidden path: $abs_path"
            done < <(
                echo "$CMD" \
                    | grep -oE '/[a-zA-Z0-9_./@+-]+' \
                    | sort -u \
                    || true
            )
        fi
        ;;
    *)
        # Tool not in our matcher → allow
        ;;
esac

exit 0
