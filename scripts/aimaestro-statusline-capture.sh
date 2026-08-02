#!/usr/bin/env bash
# =============================================================================
# AI Maestro Statusline Capture — a PASS-THROUGH wrapper   (TRDD-D8OYFG35)
# =============================================================================
#
#   aimaestro-statusline-capture.sh [--] <your existing statusline command...>
#
# Claude Code supports exactly ONE `statusLine` command, so "capture the payload
# IN ADDITION to the existing status bar" can only mean wrapping it. This script
# reads stdin once, forks a detached copy to the AI Maestro ingest CLI, and hands
# the identical bytes to the command you gave it — passing that command's stdout
# and exit code through unchanged.
#
# Install (the USER's own ~/.claude/settings.json — this script never edits it):
#
#   "statusLine": {
#     "type": "command",
#     "command": "~/.local/bin/aimaestro-statusline-capture.sh <your old command>"
#   }
#
# With no inner command it runs in CAPTURE-ONLY mode: it ingests and prints
# nothing, which is the correct behaviour for a user who has no status bar yet.
#
# ── THE FOUR PROPERTIES THIS SCRIPT EXISTS TO GUARANTEE ─────────────────────
#
# 1. NOTHING EXTRA ON STDOUT, EVER. Stray output corrupts the user's status bar.
#    Our own diagnostics go to stderr, and only under AIMAESTRO_STATUSLINE_DEBUG.
#
# 2. THE CAPTURE IS DETACHED AND NON-BLOCKING. Claude Code's own doc: "If a new
#    update triggers while your script is still running, Claude Code cancels the
#    in-flight script", debounced at 300ms. A synchronous POST would stall the
#    bar and get itself cancelled. We fork, redirect the child's stdio to
#    /dev/null, and NEVER wait.
#
# 3. FAIL-SOFT ABSOLUTELY. Server down, unreachable, slow, CLI missing, mktemp
#    refused — the bar still renders. Deliberately no `set -e`, no `set -u`, no
#    `pipefail`: each of those turns a survivable hiccup into a broken status bar
#    on every keystroke, which is the one failure mode a status line cannot have.
#
# 4. THE INNER COMMAND SEES THE EXACT BYTES. stdin is captured to a temp file and
#    replayed by redirect, never through a shell variable — command substitution
#    strips trailing newlines, and this payload is not ours to alter.
#
# Environment:
#   AIMAESTRO_STATUSLINE_CLI    override the path to aimaestro-statusline.sh
#   AIMAESTRO_STATUSLINE_DEBUG  print diagnostics to stderr (off by default)
# =============================================================================

_dbg() {
    if [ -n "${AIMAESTRO_STATUSLINE_DEBUG:-}" ]; then
        printf 'aimaestro-statusline-capture: %s\n' "$*" >&2
    fi
    return 0
}

# `--` lets an inner command whose first word starts with a dash be passed
# unambiguously. We have no options of our own, so this is the whole parsing.
if [ "${1:-}" = "--" ]; then
    shift
fi

# INTERACTIVE GUARD. Everything below reads stdin unconditionally and by design —
# Claude Code always pipes the statusline JSON in, so stdin is never a TTY on the
# production path and this branch is dead there. It exists because the script is
# installed on PATH, where the FIRST thing a human or an agent does to a new
# command is run it bare or with --help to see what it is. With no arg parsing
# (deliberately — see above) that invocation fell through to the stdin capture and
# blocked FOREVER with no output: measured at 8 minutes before the caller gave up.
# A discovery attempt that hangs the caller's session is a worse failure than an
# unknown command, so answer it instead of blocking. `[ -t 0 ]` is true ONLY when
# stdin is a terminal, so this can never trigger under Claude Code, under a pipe,
# or under `< /dev/null`.
# ⚠ TWO TRIGGERS, NOT ONE — and shipping only the second was a real bug (reported by the CORE
# plugin's Claude, 2026-08-02, on ai-maestro-plugin#31).
#
# The `[ -t 0 ]` guard below fixed the 8-minute HANG, and I wrote in that comment that it "can never
# trigger under a pipe or `< /dev/null`" — treating that as a safety property when it was also the
# hole. With stdin redirected, `--help` fell through to the exec at the bottom and was run as the
# INNER COMMAND: `line 199: --help: command not found`, **exit 0**. Silent, and worse than the hang
# it replaced, because a hang is at least visible.
#
# So `--help` is answered from the ARGUMENT, independently of what stdin is. The two triggers cover
# different callers: a human at a terminal (no args, no pipe) and anyone anywhere asking `--help`.
#
# This does not weaken "it has NO options of its own; every argument is the inner command" in any way
# that matters: no real statusline is named `--help`, and the previous behaviour for that argument
# was to fail silently rather than to run anything.
usage() { cat >&2 <<'USAGE'
aimaestro-statusline-capture.sh — statusLine WRAPPER (not a standalone command)

It reads the statusline JSON Claude Code pipes on stdin, forks a detached copy to
the ingest CLI, and relays stdin byte-for-byte to the inner command you give it,
preserving that command's stdout and exit code.

  USAGE:  aimaestro-statusline-capture.sh [--] <inner-command> [args...]

  In ~/.claude/settings.json:
      "statusLine": { "type": "command",
                      "command": "aimaestro-statusline-capture.sh <your-existing-statusline>" }

  Use `--` when the inner command's first word starts with a dash.
  It has NO options of its own; every argument is the inner command.

USAGE
}

# TRIGGER 1 — an explicit help request, from ANY caller, whatever stdin is.
case "${1-}" in
    -h|--help|help) usage; exit 0 ;;
esac

# TRIGGER 2 — a human ran it bare at a terminal: no payload is coming, so say so
# rather than block. Exit 64 (EX_USAGE) because this one IS a misuse, whereas an
# explicit --help above is a correct request and exits 0.
if [ -t 0 ]; then
    usage
    echo "Refusing to run: stdin is a terminal, so there is no statusline payload to read" >&2
    echo "and this would block indefinitely. Pipe JSON in, or invoke it from settings.json." >&2
    exit 64  # EX_USAGE
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

# Resolve the ONE component that knows the endpoint. Never inline a URL here:
# per the decoupling invariant the CLI owns that knowledge, and this wrapper sits
# in the user's live status bar where it must stay as dumb as possible.
CLI="${AIMAESTRO_STATUSLINE_CLI:-}"
if [ -z "$CLI" ]; then
    for _candidate in \
        "${SCRIPT_DIR}/aimaestro-statusline.sh" \
        "${HOME}/.local/bin/aimaestro-statusline.sh"
    do
        if [ -x "$_candidate" ]; then
            CLI="$_candidate"
            break
        fi
    done
fi
[ -z "$CLI" ] && _dbg "no aimaestro-statusline.sh found — running inner command only"

# ── Capture stdin, in ONE pass ──────────────────────────────────────────────
# Two files, written together: $PAYLOAD is replayed to the inner command by the
# parent, $CAPTURE is the detached child's own copy. Separate files because the
# alternative is a race — the parent's cleanup and the child's read are not
# ordered, and a child reading a file the parent has already unlinked would
# silently ingest nothing. `tee` writes both from ONE read of stdin, in one
# process, where `cat` + `cp` needs two.
#
# MEASURED (2026-08-02, this machine, 10 interleaved iterations against a hanging
# ingest): tee 47ms mean, cat+cp 50ms mean, against a ~41ms floor that is just the
# two `bash` startups this design cannot avoid. So the fork is worth ~3ms and the
# WRAPPER'S OWN work is ~6ms of the ~47ms total — the honest reason to prefer tee
# is one read of stdin rather than a speed claim. (An earlier draft of this comment
# said ~10ms, extrapolated from a 140ms reading taken seconds after a test suite
# finished; a correct interleaved A/B refuted both numbers.)
#
# `tee` is SAFE here specifically because neither consumer can close early: both
# are plain file redirects, so there is no SIGPIPE and no truncation (the hazard
# that makes `cmd | tee FILE | head` produce a short FILE). And if $CAPTURE cannot
# be opened, tee still copies everything to stdout → $PAYLOAD, so the status bar
# is unaffected — only the capture is lost, which is the correct order of harm.
#
# If mktemp fails we do NOT read stdin at all, so the inner command still gets it
# straight from Claude Code. Consuming it and then failing to replay it would hand
# the user's statusline an empty payload — worse than not capturing.
PAYLOAD=""
CAPTURE=""
if PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/aimaestro-statusline.XXXXXX" 2>/dev/null)"; then
    # Remove the payload on ANY exit, and set the trap the instant the file exists.
    #
    # THIS ONE IS NOT AN EDGE CASE. Claude Code's own doc: "If a new update triggers
    # while your script is still running, Claude Code cancels the in-flight script."
    # Cancellation is ROUTINE — it is what the 300ms debounce is for — so a cleanup
    # that only runs on the happy path leaks one file per cancelled tick, forever, on
    # every machine that installs this. A trailing `rm` cannot cover it; a trap can.
    #
    # SAFE ALONGSIDE THE CHILD'S OWN EXIT TRAP (verified empirically, 2026-08-02): a
    # subshell that installs its own EXIT trap REPLACES the inherited one, so the
    # detached child removes only $CAPTURE and never the $PAYLOAD the inner command
    # is still reading. The trap also leaves the exit status untouched, so the
    # pass-through of the inner's code is unaffected.
    trap 'rm -f "$PAYLOAD" 2>/dev/null' EXIT
    if [ -n "$CLI" ]; then
        CAPTURE="${PAYLOAD}.cap"
        tee "$CAPTURE" > "$PAYLOAD" 2>/dev/null
        # An unwritable (or empty) capture must not become an ingest of nothing.
        [ -s "$CAPTURE" ] || { rm -f "$CAPTURE" 2>/dev/null; CAPTURE=""; }
    else
        cat > "$PAYLOAD"
    fi
else
    PAYLOAD=""
    _dbg "mktemp failed — passing stdin straight through, no capture"
fi

# ── Fork the ingest, detached ───────────────────────────────────────────────
if [ -n "$CAPTURE" ]; then
    (
        # Ignore HUP/INT so the ingest survives Claude Code cancelling the
        # in-flight statusline script. Ignored dispositions survive exec, so
        # this covers the curl inside the CLI too. TERM is deliberately NOT
        # ignored: an operator must always be able to kill a stuck child, and
        # the CLI's own --max-time already bounds it.
        trap '' HUP INT
        # Remove the copy on ANY exit, not just the happy one. A plain `rm` after
        # the call is skipped whenever the child dies early — a TERM from an
        # operator, a shell error — and each miss leaves a payload file in TMPDIR
        # forever. SIGKILL is still unreachable (nothing can trap it), so this
        # narrows the leak rather than closing it; the OS temp cleaner is the
        # backstop for that last case.
        trap 'rm -f "$CAPTURE"' EXIT
        "$CLI" ingest --file "$CAPTURE"
    ) </dev/null >/dev/null 2>&1 &
    # NO `wait`. The whole point is that this process returns now.
fi

# ── Hand off to the real status line ────────────────────────────────────────
# Not `exec`: we still have a temp file to remove, and exec would replace this
# shell before the cleanup could run. Running it as a child costs one fork and
# keeps stdout byte-identical either way — the inner writes straight to the
# stdout we inherited, and nothing else in this script ever writes there.
RC=0
if [ $# -gt 0 ]; then
    if [ -n "$PAYLOAD" ]; then
        "$@" < "$PAYLOAD"
        RC=$?
    else
        "$@"
        RC=$?
    fi
fi

# No explicit cleanup here — the EXIT trap above owns $PAYLOAD, and owns it on the
# cancelled path too, which a line at the bottom of the script never reaches.
exit $RC
