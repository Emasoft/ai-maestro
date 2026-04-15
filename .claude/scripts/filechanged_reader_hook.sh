#!/usr/bin/env bash
# filechanged_reader.sh — alert reader.
#
# TRDD-1222f06a §2 Option B, component 3 (alert reader).
#
# Called by a FileChanged hook on .*/resume_needed_alert\.md$. Emits a
# JSON blob with `additionalContext` on stdout to wake the Claude session
# and tell it to resume work. For the smoke test (2.1), the
# additionalContext includes a distinctive marker (ALERT_READER_OK) that
# Claude must echo to confirm the wake-up loop fired.

set -uo pipefail

DEBUG_LOG="${RATE_LIMIT_DEBUG_LOG:-/tmp/rate-limit-experiment.log}"
ALERT_FILE="${CLAUDE_PROJECT_DIR:-$PWD}/resume_needed_alert.md"

log() {
  printf '%s [filechanged_reader pid=%s] %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$$" "$*" >> "$DEBUG_LOG"
}

LAST_LINE=""
if [ -f "$ALERT_FILE" ]; then
  LAST_LINE=$(tail -n 1 "$ALERT_FILE" 2>/dev/null || echo "")
fi

log "fired; alert_file=$ALERT_FILE last_line=$LAST_LINE"

# Emit the JSON blob with additionalContext. This is the only thing Claude
# Code reads from stdout for a FileChanged hook.
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "FileChanged",
    "additionalContext": "EXTERNAL WAKE: resume_needed_alert.md changed. Last line: ${LAST_LINE}. The rate limit that stopped you has passed. Resume all tasks. To confirm you received this external wake event, print the exact string ALERT_READER_OK in your next response and then continue what you were doing."
  }
}
EOF
exit 0
