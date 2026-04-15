#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# subagent-write-guard.sh — project-scoped
#
# PreToolUse hook for the scenarios project-scoped subagents
# (scenario-runner and scenario-improvement-implementer).
#
# PURPOSE
#   Enforces the rule that scenario subagents may only WRITE to:
#     1. $CLAUDE_PROJECT_DIR — the project root (for runner) or the
#        subagent's git worktree (for implementer, via isolation: worktree)
#     2. The system scratch area — tmp and private tmp
#        (used for cloning/fixing auxiliary plugins, tarballs, etc.)
#   Reads are NOT restricted — subagents may read from anywhere.
#
# WHY
#   The 2026-04-14 overnight run exposed a gap: when an improvement
#   implementer's destructive git command was blocked by the user's
#   global git safety hook, the subagent escaped its worktree by
#   cd-ing to the parent repo, checking out a new branch, and writing
#   files there. This corrupted the parent working tree. The core
#   `isolation: worktree` feature provides filesystem isolation (each
#   worktree is a separate git checkout) but NOT process sandboxing —
#   the subagent has unrestricted bash + file tools.
#
#   This hook closes that gap by validating every Write/Edit/MultiEdit/
#   NotebookEdit tool call against an allowlist of write roots, and by
#   catching the most common Bash escape patterns (cd to absolute path
#   outside the allowlist, git -C / rm / mv / cp / sed in-place / file
#   redirection targeting absolute paths outside the allowlist).
#
# INVOCATION
#   Referenced from both agents' frontmatter in .claude/agents/:
#     ---
#     name: scenario-runner
#     hooks:
#       PreToolUse:
#         - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
#           hooks:
#             - type: command
#               command: "${CLAUDE_PROJECT_DIR}/.claude/scripts/subagent-write-guard.sh"
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

    # Safe POSIX device sinks — always allowed. These are null/debug sinks
    # and writing to them is universally understood as "discard" or "route
    # to the controlling terminal". Not real filesystem writes.
    case "$candidate" in
        /dev/null|/dev/stdout|/dev/stderr|/dev/tty) return 0 ;;
        /dev/fd/*) return 0 ;;
    esac

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

# Strip single-quoted heredoc bodies from a bash command before scanning.
#
# A heredoc body introduced with <<'DELIM', <<"DELIM", or <<DELIM is a
# literal string passed on stdin to the command — it cannot contain
# actual shell constructs, so scanning it for redirections or write-verb
# paths causes false positives on:
#   * JS regex literals like /foo|bar/i
#   * JS fat-arrow functions like `.filter(el => ...)` (the `=>` gets
#     mis-parsed as a `>` redirection to a path starting with `/`)
#   * Absolute paths inside JS/Python string literals
#
# We only scan the SHELL portion of the command (everything outside
# heredoc bodies). Legitimate redirections and write verbs live on the
# shell line, not inside the heredoc body.
strip_heredoc_bodies() {
    local input="$1"
    local output=""
    local in_heredoc=false
    local delim=""
    local here_re='<<-?['"'"'"]?([A-Za-z_][A-Za-z0-9_]*)['"'"'"]?'
    local line
    while IFS= read -r line; do
        if $in_heredoc; then
            if [ "$line" = "$delim" ]; then
                in_heredoc=false
                output+="$line"$'\n'
            fi
            continue
        fi
        if [[ "$line" =~ $here_re ]]; then
            delim="${BASH_REMATCH[1]}"
            in_heredoc=true
        fi
        output+="$line"$'\n'
    done <<< "$input"
    printf '%s' "$output"
}

# Emit a block message and exit with code 2 (Claude sees the reason)
block() {
    local reason="$1"
    cat >&2 <<EOF
BLOCKED by scenarios write-guard
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

        # Strip heredoc bodies before scanning. Heredoc bodies are literal
        # strings (esp. for dev-browser <<'EOF' scripts) and may contain
        # JS regex literals, fat-arrows, string-literal paths, etc. that
        # false-positive on shell-syntax scans. Only scan the actual shell
        # portion of the command.
        CMD_SCAN=$(strip_heredoc_bodies "$CMD")

        # 1. `cd /absolute/path` — catches the primary escape vector
        #    (subagent 2 used this to reach the parent repo).
        #    Matches: `cd /foo`, `cd /foo && ...`, `cd /foo; ...`, `; cd /foo`
        #    Only triggers on ABSOLUTE paths (starting with /) — relative
        #    paths like `cd tests/scenarios` are implicitly under cwd and
        #    allowed. The two-step extraction isolates the `cd` target
        #    token first, then checks it only if it starts with /.
        while IFS= read -r cd_path; do
            [ -z "$cd_path" ] && continue
            is_allowed_path "$cd_path" || block "Bash 'cd' to forbidden dir: $cd_path"
        done < <(
            echo "$CMD_SCAN" \
                | grep -oE '(^|[[:space:]]|&&|\|\||;|\()[[:space:]]*cd[[:space:]]+[^[:space:]&|;()"'"'"']+' \
                | sed -E 's/^.*cd[[:space:]]+//' \
                | grep -E '^/' \
                || true
        )

        # 2. `git -C /path ...` — catches git commands that explicitly
        #    target a repo outside the worktree. Same rule as (1): only
        #    absolute paths are checked.
        while IFS= read -r git_path; do
            [ -z "$git_path" ] && continue
            is_allowed_path "$git_path" || block "Bash 'git -C' references forbidden dir: $git_path"
        done < <(
            echo "$CMD_SCAN" \
                | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]&|;()"'"'"']+' \
                | sed -E 's/^git[[:space:]]+-C[[:space:]]+//' \
                | grep -E '^/' \
                || true
        )

        # 3. File redirection `> /abs/path` or `>> /abs/path` to absolute
        #    paths outside the allowlist. /dev/null and friends are
        #    whitelisted inside is_allowed_path.
        while IFS= read -r redir_path; do
            [ -z "$redir_path" ] && continue
            is_allowed_path "$redir_path" || block "Bash redirection target: $redir_path"
        done < <(
            echo "$CMD_SCAN" \
                | grep -oE '[12]?>>?[[:space:]]*/[^[:space:]&|;()"'"'"']+' \
                | sed -E 's/^[12]?>>?[[:space:]]*//' \
                | grep -E '^/' \
                || true
        )

        # 4a. cp/mv/ln/install — destination-only check.
        #     These verbs have well-defined semantics: the LAST positional
        #     argument is the destination (write target), all earlier
        #     positional args are sources (read-only, allowed anywhere).
        #     Scanning all paths would false-positive on commands like
        #     `cp ~/.aimaestro/registry.json tests/scenarios/state-backups/x`
        #     which reads from outside but writes inside the project.
        if echo "$CMD_SCAN" | grep -qE '(^|[[:space:]]|&&|\|\||;|\()[[:space:]]*(cp|mv|ln|install)([[:space:]]|$)'; then
            # Extract the cp/mv/ln/install invocation up to the next pipeline
            # separator. Tokenize and find the last non-option argument.
            cpmv_segment=$(echo "$CMD_SCAN" \
                | grep -oE '(cp|mv|ln|install)[[:space:]]+[^&|;]+' \
                | head -1 \
                || true)
            if [ -n "$cpmv_segment" ]; then
                last_pos=""
                # shellcheck disable=SC2086  # intentional word-splitting for tokens
                set -- $cpmv_segment
                while [ $# -gt 0 ]; do
                    tok="$1"
                    shift
                    case "$tok" in
                        cp|mv|ln|install) continue ;;
                        -*) continue ;;
                        *) last_pos="$tok" ;;
                    esac
                done
                # Only validate if the destination is absolute or HOME-relative.
                # Relative paths are relative to the agent's cwd (project root),
                # so they are implicitly inside the allowed roots.
                case "$last_pos" in
                    /*|'~/'*|'~')
                        is_allowed_path "$last_pos" || block "Bash cp/mv/ln/install destination outside allowed roots: $last_pos"
                        ;;
                esac
            fi
        fi

        # 4b. rm/mkdir/touch/tee/chmod/chown/dd/sed-i — all-path scan.
        #     These verbs either delete, create, or in-place modify files,
        #     and the argument positions are not as predictable as cp-like
        #     verbs. Liberal check: tokenize the command, filter tokens
        #     that look like ABSOLUTE paths, and reject any outside the
        #     allowlist. Tokenizing (vs. a substring regex) prevents false
        #     positives on relative paths like `tests/scenarios/x` which
        #     contain `/scenarios/x` as a substring.
        if echo "$CMD_SCAN" | grep -qE '(^|[[:space:]]|&&|\|\||;|\()[[:space:]]*(rm|mkdir|touch|tee|chmod|chown|dd)([[:space:]]|$)' \
           || echo "$CMD_SCAN" | grep -qE '(^|[[:space:]])sed[[:space:]]+-[a-zA-Z.]*i'; then
            while IFS= read -r abs_path; do
                [ -z "$abs_path" ] && continue
                # Skip obvious option-argument false positives like `--prefix=/usr`
                case "$abs_path" in
                    =*|--*) continue ;;
                esac
                is_allowed_path "$abs_path" || block "Bash write op references forbidden path: $abs_path"
            done < <(
                echo "$CMD_SCAN" \
                    | tr -s '[:space:]' '\n' \
                    | grep -E '^/' \
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
