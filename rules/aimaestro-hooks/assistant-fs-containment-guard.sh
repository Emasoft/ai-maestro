#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# assistant-fs-containment-guard.sh — ASSISTANT-role filesystem containment
# (TRDD-U7MJUHWJ, expanding the USER ruling in TRDD-3QRUDK12)
#
# PreToolUse hook installed ONLY into ASSISTANT-titled agents' workdirs by
# the server's `assistant-fs-containment` invariant (lib/agent-invariants.ts).
# It is NOT installed into any other agent, and it is NOT a project-scoped
# hook of the ai-maestro repo itself.
#
# PURPOSE (USER ruling, TRDD-3QRUDK12 verbatim):
#   "reading the host files outside of the workdir and outside of those
#   exeptions, is strictly blocked by hooks and other permissions rules
#   specific of the ASSISTANT role plugin."
#   The ruling blocks READS as well as writes — unlike the scenarios
#   subagent guard (.claude/scripts/subagent-write-guard.sh), which is
#   write-only by design. This script enforces BOTH halves.
#
# ALLOWLIST (the ONLY things reachable — enumerated, nothing else):
#   1. The ASSISTANT's own workdir (its $CLAUDE_PROJECT_DIR)
#   2. Designated locally-scoped folders   — $ASSISTANT_LOCAL_FOLDERS
#   3. Approved project-scoped folders     — $ASSISTANT_PROJECT_FOLDERS
#      (populated by the server only after the MANAGER approves the
#      collaboration, per TRDD-U4KP0H92; empty by default)
#   4. The ASSISTANT's own dot-state trees — ~/.claude and ~/.aimaestro
#      subpaths (its own identity, its own messaging, its own plugins)
#   5. Safe POSIX device sinks (/dev/null, /dev/stdout, …)
#
# WHY THE FOLDERS ARRIVE AS ENV: the invariant rewrites the hook's
# settings.local.json entry on every enforcement pass, so an approved
# collaboration grants access by a server write, never by the agent
# editing its own allowlist. An agent-side edit is overwritten (the
# invariant owns the file) AND the file is server-readable — both paths
# out of the allowlist are closed by the server, not by trust.
#
# FAIL CLOSED: any unresolvable or ambiguous case BLOCKS. A containment
# guard that cannot decide must never read as permission (same ruling as
# the subagent write-guard, TRDD-YR4G2CZH).
#
# INPUT (Claude Code PreToolUse JSON on stdin):
#   { "tool_name": "...", "tool_input": { "file_path"|"notebook_path"|
#     "command"|"path": ... }, "cwd": "..." }
#
# EXIT CODES
#   0 — allow the tool call
#   2 — block the tool call (stderr becomes the reason shown to Claude)
#
# DEPENDENCIES: jq (any version); realpath (optional — falls back to
#   lexical normalization when absent)
# ────────────────────────────────────────────────────────────────────
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# ── Root resolution: workdir → payload cwd → refuse. Same ladder as the
# subagent write-guard, for the same reason: CC may expand the
# ${CLAUDE_PROJECT_DIR} placeholder in the hook COMMAND without exporting
# it into the hook's ENVIRONMENT, and a guard that then silently allowed
# everything would be indistinguishable from no guard at all.
WORKDIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$WORKDIR" ]; then
    WORKDIR=$(echo "$INPUT" | jq -r '.cwd // ""')
fi
if [ -z "$WORKDIR" ]; then
    echo "[assistant-fs-guard] BLOCKED: cannot resolve the ASSISTANT workdir." >&2
    echo "  Tried \$CLAUDE_PROJECT_DIR and the hook payload's .cwd; both empty." >&2
    echo "  This guard enforces the TRDD-3QRUDK12 containment ruling; an" >&2
    echo "  unenforceable state must not read as permission." >&2
    exit 2
fi

if command -v realpath >/dev/null 2>&1; then
    WORKDIR_ABS=$(realpath -m "$WORKDIR" 2>/dev/null || echo "$WORKDIR")
else
    WORKDIR_ABS="$WORKDIR"
fi

# ── Allowlist assembly. Each entry is one absolute directory; the loop
# below admits it and everything under it.
ALLOWED_ROOTS=()
# The WORKDIR itself is realpath'd above; every allowlist entry must be
# normalized the SAME WAY, or a symlinked root (/tmp -> /private/tmp on
# macOS) is admitted under its lexical name while candidates arrive
# resolved — an allowlisted folder that silently matches nothing.
for entry in "$WORKDIR_ABS" ${ASSISTANT_LOCAL_FOLDERS:-} ${ASSISTANT_PROJECT_FOLDERS:-}; do
    [ -n "$entry" ] || continue
    case "$entry" in
        '~'*) entry="${HOME}${entry#\~}" ;;
    esac
    if command -v realpath >/dev/null 2>&1; then
        entry=$(realpath -m "$entry" 2>/dev/null || echo "$entry")
    fi
    ALLOWED_ROOTS+=("$entry")
done

normalize_path() {
    local path="$1"
    # Tool input arrives as JSON strings, so bash never expanded a leading
    # `~` — do it here before comparing against $HOME-rooted allowlist entries.
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

# The core decision: is this absolute path inside the workdir, an
# allowlisted root, or one of the ASSISTANT's own dot-state trees?
is_allowed_path() {
    local candidate="$1"
    [ -z "$candidate" ] && return 1

    # Safe POSIX device sinks — discards and tty routes, not filesystem writes.
    case "$candidate" in
        /dev/null|/dev/stdout|/dev/stderr|/dev/tty) return 0 ;;
        /dev/fd/*) return 0 ;;
    esac

    local abs
    abs=$(normalize_path "$candidate")

    local root
    for root in "${ALLOWED_ROOTS[@]}"; do
        # `"$root"/*` needs the trailing slash on the ROOT half of the
        # pattern, not on the candidate: `$root` alone is also admitted,
        # and ".../alpha" must not admit ".../alpha2" (no sibling-prefix leak).
        case "$abs" in
            "$root"|"$root"/*) return 0 ;;
        esac
    done

    # The ASSISTANT's own dot-state. TRDD-3QRUDK12 grants "files belonging
    # to the very assistant": its Claude Code identity/config and its
    # ai-maestro state (AMP keys, AID, its own plugin scope). Reads here
    # are how it participates in the harness at all.
    case "$abs" in
        "$HOME"/.claude|"$HOME"/.claude/*) return 0 ;;
        "$HOME"/.aimaestro|"$HOME"/.aimaestro/*) return 0 ;;
    esac

    return 1
}

# Strip single-quoted heredoc bodies before scanning a Bash command. A heredoc
# body is literal stdin text (dev-browser EOF scripts, file writes) carrying
# string-literal paths and JS regexes that are DATA, not shell — scanning it
# false-positives on every embedded absolute path. Only the shell line is
# scanned, same reasoning as the subagent write-guard. MUST be defined before
# the case statement that calls it: bash resolves functions at execution time,
# so a definition after the call is a live "command not found" under set -e.
strip_heredoc_bodies() {
    local input="$1"
    local output=""
    local in_heredoc=false
    local delim=""
    # Allow whitespace between << and the delimiter: `cat << 'EOF'` is the idiomatic
    # spelling, and a delimiter written spaced MUST still open a heredoc — otherwise
    # the body is scanned as shell and its data paths false-positive blocks.
    local here_re='<<-?[[:space:]]*['"'"'"]?([A-Za-z_][A-Za-z0-9_]*)['"'"'"]?'
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

block() {
    local reason="$1"
    echo "BLOCKED by ASSISTANT filesystem containment (TRDD-3QRUDK12 ruling):" >&2
    echo "  $reason" >&2
    echo "" >&2
    echo "The ASSISTANT role may reach ONLY:" >&2
    echo "  - its own workdir: $WORKDIR_ABS" >&2
    echo "  - designated local folders / approved project folders (server-set)" >&2
    echo "  - its own ~/.claude and ~/.aimaestro state" >&2
    echo "Reads outside these are blocked too, not just writes. If a task" >&2
    echo "genuinely needs another path, ask your USER — the MANAGER approves" >&2
    echo "collaborations, which the server then adds to the allowlist." >&2
    exit 2
}

# ── Per-tool extraction ─────────────────────────────────────────────
case "$TOOL_NAME" in
    Write|Edit|MultiEdit)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
        is_allowed_path "$FILE_PATH" || block "$TOOL_NAME target '$FILE_PATH' is outside the containment allowlist"
        ;;
    NotebookEdit)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.notebook_path // ""')
        is_allowed_path "$FILE_PATH" || block "NotebookEdit target '$FILE_PATH' is outside the containment allowlist"
        ;;
    Read)
        # TRDD-3QRUDK12: "restrict even more the access to files outside
        # the workdir, EVEN FOR READS". The Read tool carries file_path.
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
        is_allowed_path "$FILE_PATH" || block "Read target '$FILE_PATH' is outside the containment allowlist (reads are contained too)"
        ;;
    Glob|Grep|LS)
        # These tools take a path-ish argument. Absent a path they default
        # to cwd, which is always inside the workdir — only check when set.
        SCAN_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // ""')
        if [ -n "$SCAN_PATH" ]; then
            is_allowed_path "$SCAN_PATH" || block "$TOOL_NAME scan root '$SCAN_PATH' is outside the containment allowlist"
        fi
        ;;
    Bash)
        CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
        CMD_SCAN=$(strip_heredoc_bodies "$CMD")

        # Reads AND writes: any ABSOLUTE path token on the shell line must
        # be inside the allowlist. Deliberately broader than the write-verb
        # scan of the subagent guard — the ruling blocks reads, and
        # `cat /Users/me/secret` is a read.
        #
        # ponytail: lexical token scan, not shell parsing. A command that
        # hides a path from tokenization (process substitution, IFS tricks)
        # evades it — the upgrade path is a real bash parser, not more
        # regex. Known ceiling, accepted for v1.
        while IFS= read -r abs_path; do
            [ -z "$abs_path" ] && continue
            case "$abs_path" in
                =*|--*) continue ;;          # --prefix=/usr style option args
                /dev/null|/dev/stdout|/dev/stderr|/dev/tty|/dev/fd/*) continue ;;
            esac
            is_allowed_path "$abs_path" || block "Bash command references forbidden path: $abs_path (reads are contained too)"
        done < <(
            echo "$CMD_SCAN" \
                | tr -s '[:space:]' '\n' \
                | grep -E '^(/|~/)' \
                | sort -u \
                || true
        )
        # `~`-prefixed tokens normalize to $HOME above, which is NOT in the
        # allowlist (only its .claude/.aimaestro subtrees are). Relative
        # paths stay relative to the session cwd, already bounded by the
        # workdir containment.
        ;;
    *)
        # Tool not in the matcher → allow. The settings.local.json matcher
        # lists exactly the tools above; anything else has no filesystem
        # path input this guard knows how to check.
        ;;
esac

exit 0
