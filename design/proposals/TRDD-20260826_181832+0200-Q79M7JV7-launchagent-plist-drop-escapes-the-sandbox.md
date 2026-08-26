---
trdd-id: Q79M7JV7
title: The sandbox profile leaves macOS persistence surfaces writable so a dropped LaunchAgent runs outside it
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:18:32+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, sandbox, macos]
external-refs: [TRDD-EVO7T245]
---

## Problem

The proposed per-agent seatbelt profile uses `(allow default)` plus targeted denies. That
shape leaves persistence mechanisms open, and a persistence mechanism is a sandbox escape
with a delay.

## Evidence (measured 2026-08-26)

```
PLIST DROP into ~/Library/LaunchAgents/ : ALLOWED   <- launchd runs it OUTSIDE the sandbox
```

Two proxy escapes were tested and are CLOSED, recorded here so nobody re-tests them:

```
launchctl submit (sandboxed)            : exit 1, no escape file
  CONTROL, unsandboxed                  : WROTE the file -> the proxy genuinely works, so
                                          the sandboxed block is real and not a false zero
osascript "do shell script" (sandboxed) : inherits the sandbox, tmux connect denied
```

## Task

1. INVESTIGATE — enumerate macOS persistence surfaces reachable by the agent uid:
   `~/Library/LaunchAgents`, `~/Library/LaunchDaemons`, login items, `~/Library/Application
   Support` autostart hooks, cron/at, and anything launchd reads at login.
2. ASSESS — for each, whether the resulting process runs outside the sandbox.
3. SAFEGUARD — deny writes to all of them in the profile.

## Acceptance

- [ ] Persistence surfaces enumerated with a measured in/out-of-sandbox verdict each.
- [ ] Profile denies each one; a probe proves the drop is refused.
- [ ] A control proving the probe can succeed when the deny is removed (non-vacuity).
