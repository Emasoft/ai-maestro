#!/usr/bin/env python3
"""
write_alerts_bot.py — background polling bot for rate-limit retry.

TRDD-1222f06a §2 Option B, component 2 (alert bot).

Invoked by start_alerts_bot.sh when a StopFailure hook fires on a transient
API error. Appends a timestamped line to resume_needed_alert.md every
--interval seconds, until killed by stop_alerts_bot.sh (which is called
by the Stop hook on any successful turn end — "proof of life" shutdown).

Singleton pidfile is managed by the start/stop helper shell scripts;
this bot only WRITES its PID on startup and REMOVES it on clean exit.
"""
import argparse
import os
import signal
import sys
import time
from datetime import datetime, timezone

DEBUG_LOG = os.environ.get("RATE_LIMIT_DEBUG_LOG", "/tmp/rate-limit-experiment.log")


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    try:
        with open(DEBUG_LOG, "a") as f:
            f.write(f"{ts} [write_alerts_bot pid={os.getpid()}] {msg}\n")
    except OSError:
        pass


def ts_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--file", required=True, help="alert file to append to")
    p.add_argument("--pidfile", required=True, help="singleton pidfile")
    p.add_argument("--interval", type=int, default=300, help="tick interval seconds")
    p.add_argument(
        "--message",
        default="there was a rate limit api error at {ts}",
        help="line template, {ts} is substituted with ISO timestamp",
    )
    args = p.parse_args()

    log(f"starting: file={args.file} pidfile={args.pidfile} interval={args.interval}")

    try:
        with open(args.pidfile, "w") as f:
            f.write(str(os.getpid()))
    except OSError as e:
        log(f"FAILED to write pidfile: {e}")
        sys.exit(1)

    def on_term(signum, _frame):
        log(f"received signal {signum}, cleaning up")
        try:
            os.unlink(args.pidfile)
        except FileNotFoundError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    signal.signal(signal.SIGHUP, on_term)

    tick = 0
    while True:
        tick += 1
        line = args.message.format(ts=ts_iso())
        try:
            with open(args.file, "a") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())
            log(f"tick={tick} appended: {line!r}")
        except OSError as e:
            log(f"tick={tick} FAILED to append: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
