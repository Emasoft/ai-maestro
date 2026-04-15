#!/usr/bin/env bash
# stop_alerts_bot.sh — alert stopper helper.
#
# TRDD-1222f06a §2 Option B, component 4 (alert stopper).
#
# Called by the Stop hook on every successful turn end. Fast-path no-op
# if the pidfile doesn't exist. The bot can only die via a successful
# Claude turn — this is the "proof of life" shutdown guarantee.

set -uo pipefail

DEBUG_LOG="${RATE_LIMIT_DEBUG_LOG:-/tmp/rate-limit-experiment.log}"
PIDFILE="${WRITE_ALERTS_BOT_PIDFILE:-/tmp/write_alerts_bot.pid}"

log() {
  printf '%s [stop_alerts_bot pid=%s] %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$$" "$*" >> "$DEBUG_LOG"
}

# Fast-path no-op — pidfile absent means no bot is running.
if [ ! -f "$PIDFILE" ]; then
  # Don't log the fast-path — it runs on every turn and would flood the log.
  exit 0
fi

PID=$(cat "$PIDFILE" 2>/dev/null || echo "")

if [ -z "$PID" ]; then
  log "pidfile exists but is empty; removing"
  rm -f "$PIDFILE"
  exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
  if kill "$PID" 2>/dev/null; then
    log "killed bot pid=$PID"
  else
    log "failed to kill bot pid=$PID (errno $?)"
  fi
else
  log "stale pidfile (pid=$PID not alive), removing"
fi

rm -f "$PIDFILE"
exit 0
