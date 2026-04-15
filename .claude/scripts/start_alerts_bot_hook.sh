#!/usr/bin/env bash
# start_alerts_bot.sh — alert detector helper.
#
# TRDD-1222f06a §2 Option B, component 1 (alert detector).
#
# Called by the StopFailure hook on transient API errors (rate_limit,
# authentication_failed, overloaded, billing_error, network errors).
# Launches write_alerts_bot.py as a detached background process with
# singleton-pidfile guard. The hook's exit code and stdout are ignored
# by Claude Code per the official docs, so this is fire-and-forget.

# No -e: pidfile checks are expected to fail in the "no bot running" case.
set -uo pipefail

DEBUG_LOG="${RATE_LIMIT_DEBUG_LOG:-/tmp/rate-limit-experiment.log}"
PIDFILE="${WRITE_ALERTS_BOT_PIDFILE:-/tmp/write_alerts_bot.pid}"
ALERT_FILE="${WRITE_ALERTS_BOT_FILE:-${CLAUDE_PROJECT_DIR:-$PWD}/resume_needed_alert.md}"
INTERVAL="${WRITE_ALERTS_BOT_INTERVAL:-15}"
BOT_SCRIPT="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/scripts/write_alerts_bot.py"
BOT_OUT="/tmp/write_alerts_bot.out"

log() {
  printf '%s [start_alerts_bot pid=%s] %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$$" "$*" >> "$DEBUG_LOG"
}

log "invoked; args=$* env.PIDFILE=$PIDFILE env.ALERT_FILE=$ALERT_FILE env.INTERVAL=$INTERVAL"

if [ ! -f "$BOT_SCRIPT" ]; then
  log "FATAL bot script missing: $BOT_SCRIPT"
  exit 0
fi

# Singleton guard
if [ -f "$PIDFILE" ]; then
  EXISTING_PID=$(cat "$PIDFILE" 2>/dev/null || echo "")
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    log "bot already running pid=$EXISTING_PID, skip respawn"
    exit 0
  fi
  log "stale pidfile detected (pid=$EXISTING_PID not alive), removing"
  rm -f "$PIDFILE"
fi

# Spawn detached background process.
# `nohup` + `&` + `disown` on bash detaches from the parent's job table.
# Redirect all stdio to /tmp/write_alerts_bot.out so the hook exits cleanly.
nohup python3 "$BOT_SCRIPT" \
  --file "$ALERT_FILE" \
  --pidfile "$PIDFILE" \
  --interval "$INTERVAL" \
  >> "$BOT_OUT" 2>&1 &
BOT_PID=$!

# disown so the bot is not in the parent bash's job table; protects against
# SIGHUP on shell exit on some macOS configurations.
disown "$BOT_PID" 2>/dev/null || true

log "spawned bot pid=$BOT_PID (expected to write its own pidfile shortly)"
exit 0
