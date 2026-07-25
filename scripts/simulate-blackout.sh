#!/usr/bin/env bash
# Simulate a power loss WITHOUT rebooting the machine (TRDD-NIU5RQ1S).
#
# WHY THIS EXISTS: the recovery chain is only trustworthy if it has actually been executed, and a
# real reboot is far too expensive to run on every change — so the one path that must never break
# would otherwise be the one path never tested. This reproduces every link EXCEPT the OS handing
# control to pm2:
#
#   power loss              → SIGKILL the server (no graceful shutdown, no state flush)
#   OS starts pm2 at boot   → NOT simulated: that is launchd/systemd, and it is what
#                             `lib/boot-persistence.ts` reports on instead
#   pm2 resurrect / restart → this script restarts the app FROM ecosystem.config.js
#   boot-restore            → observed in the log
#   agents resume           → observed in the log, per agent, with the verb used
#
# SIGKILL is the point. A graceful `pm2 stop` lets the server write state on the way out, which is
# exactly what a blackout does NOT allow — so a test built on `stop` proves the easy case and
# leaves the real one unexercised.
#
# SAFE BY DESIGN: agents live in tmux sessions that are separate processes, so killing the server
# does not kill them; boot-restore reconciles on the way back up. Nothing outside the project is
# written. The script is read-only with --dry-run.

set -euo pipefail

APP_NAME="${APP_NAME:-ai-maestro}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

fail() { echo "FAIL: $*" >&2; exit 1; }

command -v pm2 >/dev/null 2>&1 || fail "pm2 is not on PATH"
pm2 describe "$APP_NAME" >/dev/null 2>&1 || fail "pm2 has no process named '$APP_NAME' — start it first"

# ── Before ────────────────────────────────────────────────────────────────────
echo "==> BEFORE"
BEFORE_PID="$(pm2 jlist | python3 -c "
import json,sys
print(next((p['pid'] for p in json.load(sys.stdin) if p['name']=='$APP_NAME'), ''))
")"
[ -n "$BEFORE_PID" ] || fail "could not read the server pid from pm2"

# THE PROCESS THAT MATTERS IS THE ONE HOLDING THE PORT, NOT THE ONE PM2 NAMES.
# `tsx` spawns a child node, so pm2 supervises the launcher while the child is the actual server.
# Killing pm2's pid therefore ORPHANS the server: it keeps serving with PPID 1 while pm2 spawns
# replacement after replacement that all die on EADDRINUSE — a crash loop that is invisible because
# every health probe still answers 200/401 from the orphan. That is what an earlier version of this
# script did to this host (39 restarts before anyone looked), so the port holder is now the kill
# target and the mismatch is reported rather than silently worked around.
PORT_PID="$(lsof -nP -iTCP:23000 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
[ -n "$PORT_PID" ] || fail "nothing is listening on :23000 — the server is already down"
echo "    pm2-tracked pid  : $BEFORE_PID"
echo "    port-holder pid  : $PORT_PID"
if [ "$PORT_PID" != "$BEFORE_PID" ]; then
  echo "    ⚠ pm2 does NOT directly supervise the listener (tsx spawns a child)."
  echo "      A stray kill of the pm2 pid would orphan the server. Killing the TREE below."
fi

# The agents we expect to come back. Read from tmux, which is the ground truth for "alive now" —
# not from the registry, which records intent.
BEFORE_SESSIONS="$(tmux ls -F '#{session_name}' 2>/dev/null | sort || true)"
echo "    tmux sessions    : $(echo "$BEFORE_SESSIONS" | tr '\n' ' ')"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "--dry-run: would SIGKILL $BEFORE_PID, then restart from ecosystem.config.js. Nothing done."
  exit 0
fi

# ── The blackout ──────────────────────────────────────────────────────────────
# Mark the log so we only ever read lines produced by THIS run — a grep over the whole log would
# happily match a previous restore and report a success that did not happen.
MARK="blackout-sim-$(date +%s)"
echo
echo "==> BLACKOUT: SIGKILL the whole server tree (marker $MARK)"
# A power cut takes every process at once. Killing only one of them leaves a half-dead system that
# no real outage produces, and then "does it recover?" is answering the wrong question.
kill -9 "$PORT_PID" 2>/dev/null || true
[ "$PORT_PID" != "$BEFORE_PID" ] && kill -9 "$BEFORE_PID" 2>/dev/null || true

# ── Recovery: pm2's OWN autorestart ───────────────────────────────────────────
# Deliberately NOT `pm2 restart` here. A blackout does not come with someone typing a restart
# command — the whole question is whether the supervisor revives the process unaided, so issuing
# the restart ourselves would test our own typing and skip the mechanism. (An earlier version did
# exactly that, and racing pm2's in-flight autorestart made it report the boot path BROKEN when it
# was working; the fix was to stop competing with the thing under test.)
echo "==> RECOVERY: waiting for pm2's own autorestart (nobody is typing a restart in a blackout)"
CODE=""
for _ in $(seq 1 90); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' localhost:23000/api/sessions || true)"
  # 401 = up and demanding auth, which is the healthy answer to an unauthenticated probe.
  if [ "$CODE" = "401" ] || [ "$CODE" = "200" ]; then break; fi
  sleep 2
done
if [ "$CODE" != "401" ] && [ "$CODE" != "200" ]; then
  fail "server did not come back on its own (last HTTP code: ${CODE:-none}) — pm2 autorestart is BROKEN"
fi
echo "    server answered  : HTTP $CODE"

# ── Verify the chain ──────────────────────────────────────────────────────────
echo "==> waiting for boot-restore to finish..."
for _ in $(seq 1 45); do
  pm2 logs "$APP_NAME" --lines 300 --nostream --raw > /tmp/blackout-sim.log 2>&1 || true
  grep -q "\[BootRestore\] Done" /tmp/blackout-sim.log && break
  sleep 2
done

echo
echo "==> RESULT"
AFTER_PORT_PID="$(lsof -nP -iTCP:23000 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
[ -n "$AFTER_PORT_PID" ] || fail "nothing is listening after recovery"
[ "$AFTER_PORT_PID" != "$PORT_PID" ] || fail "the listener pid is unchanged — it was never killed"
echo "    new listener pid : $AFTER_PORT_PID (was $PORT_PID)"

# A crash loop answers health checks from whichever instance is up at that instant, so "it responds"
# is not evidence of recovery. A restart counter that keeps climbing is.
R1="$(pm2 jlist | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['pm2_env']['restart_time'])")"
sleep 6
R2="$(pm2 jlist | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['pm2_env']['restart_time'])")"
[ "$R1" = "$R2" ] || fail "pm2 is CRASH-LOOPING (restarts $R1 → $R2 in 6s) — recovery only looks healthy"
echo "    pm2 restarts     : $R2 (stable)"

grep -E "\[BootRestore\]" /tmp/blackout-sim.log | tail -6 || fail "no boot-restore ran"
echo
echo "    per-agent resume decisions:"
grep -E "\[Wake\].*(resuming prior conversation|cold start)" /tmp/blackout-sim.log | tail -10 || \
  echo "    (none — no agent was active before the blackout)"
echo
grep -E "\[BootPersistence\]" /tmp/blackout-sim.log | tail -2 || true

# Every session alive before must be alive after. This is the assertion that matters: the log can
# claim a restore while the session is gone.
AFTER_SESSIONS="$(tmux ls -F '#{session_name}' 2>/dev/null | sort || true)"
MISSING="$(comm -23 <(echo "$BEFORE_SESSIONS") <(echo "$AFTER_SESSIONS") || true)"
if [ -n "$MISSING" ]; then
  fail "sessions LOST across the blackout: $(echo "$MISSING" | tr '\n' ' ')"
fi

echo
echo "PASS — server died and came back; every pre-blackout tmux session survived."
echo "NOTE: the OS→pm2 link (launchd/systemd/WSL) is NOT covered here by design."
echo "      Run scripts/install-boot-persistence.sh, and read the [BootPersistence] line above."
