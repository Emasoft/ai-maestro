#!/usr/bin/env bash
# cwdchanged_watch_filewatch_hook.sh — CwdChanged hook that seeds the
# FileChanged dynamic watch list.
#
# TRDD-1222f06a §2 Option B, component 3 (alert reader — setup half).
#
# Per the Claude Code hooks docs, the static FileChanged matcher only
# watches files in the current working directory. Absolute paths must be
# registered dynamically via CwdChanged's watchPaths output. This hook
# fires whenever the cwd changes and re-adds resume_needed_alert.md to
# the dynamic watch list.

set -uo pipefail

DEBUG_LOG="${RATE_LIMIT_DEBUG_LOG:-/tmp/rate-limit-experiment.log}"
ALERT_FILE="${CLAUDE_PROJECT_DIR:-/Users/emanuelesabetta/ai-maestro}/resume_needed_alert.md"

log() {
  printf '%s [cwdchanged_watch pid=%s] %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$$" "$*" >> "$DEBUG_LOG"
}

log "fired; registering watchPath=$ALERT_FILE"

# Emit JSON that adds the alert file to the FileChanged dynamic watch
# list. Returning only this file (single-element array) replaces the
# dynamic list with exactly one entry — the one we want to watch.
cat <<EOF
{
  "watchPaths": ["$ALERT_FILE"]
}
EOF
exit 0
