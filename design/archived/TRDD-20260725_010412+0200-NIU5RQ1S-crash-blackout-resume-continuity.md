---
trdd-id: NIU5RQ1S
title: Crash and blackout resume — the server and every agent come back exactly where they left off
column: complete
scope: project
created: 2026-07-25T01:04:12+0200
updated: 2026-07-25T01:22:35+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-25T01:04:12+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
relevant-rules: [16, 23]
labels: [continuity, resurrection, blackout, pm2, boot-restore]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

**USER mandate (2026-07-25, verbatim intent):** *"we need ai-maestro server to be able to resume
automatically in case of a crash or black-out. all agents must resume their work exactly from
where they left it. the janitor daemon used one method, but you can use a different method since
the ai-maestro server is based on pm2 and has a different api architecture. so for this you must
not port line by line, but interpret and adapt to the different harness."*

So this is an ADAPTATION, not a port. The daemon's method (a long-lived Python process babysitting
its own children) is not the server's method: pm2 owns process supervision, launchd owns machine
boot, and the server owns agent lifecycle. Each layer keeps what it is already good at.

### The chain, and where it stands NOW (all five verified, none assumed)

```
power loss / reboot
  → [1] launchd must resurrect the pm2 daemon        ✓ unit present + a startup self-check reports it
  → [2] pm2 must restart ai-maestro (and keep trying) ✓ retries forever with exponential backoff
  → [3] server boot-restore re-wakes active agents    ✓ works (JAU1ES1C hardened it)
  → [4] each agent must resume ITS CONVERSATION       ✓ wake appends the client's resume verb
  → [5] something must nudge the resumed agent to act ✓ fleet-recovery actuator (armed)
```

**SUPERSEDED — do NOT carry forward.** This block previously read *"[1] BROKEN — no LaunchAgent
exists"*, and commit 18aaf300's message repeated it. **That claim was FALSE.**
`~/Library/LaunchAgents/pm2.emanuelesabetta.plist` exists (Label `com.PM2`, `RunAtLoad` +
`KeepAlive` true) and `launchctl print-disabled` reports it enabled. It was asserted from the
docstring's premise instead of from a check — the exact failure mode this TRDD's self-check exists
to remove, committed by the agent writing the self-check. Anything downstream of "no LaunchAgent
exists" is void.

**What is actually true of [1], found only by asking the init system.** The unit is present and
enabled but **not bootstrapped in the running launchd domain** (`launchctl print gui/$UID/com.PM2`
→ not found). A reboot still recovers, because login re-loads `~/Library/LaunchAgents` and
`RunAtLoad` fires. What is NOT covered is the interval before that: nothing supervises pm2 right
now, so a pm2-daemon death today goes unrecovered — `KeepAlive` only applies to a *loaded* job. The
self-check reports this as its own status (`unit-not-loaded`, `willSurviveReboot: true`) rather
than folding it into a false OK or a false alarm. **Residual human action:**
`launchctl bootstrap gui/$UID ~/Library/LaunchAgents/pm2.$USER.plist`.

**[4] was the gap the USER's sentence is actually about, and it was real.** `wakeAgent` built its
launch command as `startCommand + resolveLaunchArgs(...)` and never added a resume verb, so a
boot-restored agent came back alive, in the right repo, and having forgotten everything — restarted,
not resumed. Now `decideResume()` (lib/claude-conversation.ts) appends the client's verb when a
transcript exists, refusing subcommand-form verbs because appending those builds an *invalid*
command, which is worse than a cold start.

**[2] was a real hole.** `max_restarts: 10` with `min_uptime: '10s'`: a genuine crash-loop exhausts
the budget and pm2 stops trying FOREVER. Now `max_restarts: 10000` + `exp_backoff_restart_delay`.

**Also verified while tracing the boot path** (a wrong Node there would crash-loop the resurrected
server forever, now *politely* forever thanks to the backoff): `/opt/homebrew/bin/node` is v26.5.0,
outside `engines >=22 <26`, and the LaunchAgent bakes a homebrew-first PATH. The boot entrypoint is
nevertheless safe — `scripts/start-with-ssh.sh` sources `scripts/pin-node.sh`, the same single
source of truth build/test use, which version-CHECKS candidates and fails fast.

### NEXT ACTION

None — all five acceptance boxes are met (commits 18aaf300, 7cbc2ecc, 9d71c3ef). The one remaining
step is the human's `launchctl bootstrap` line above.

**BOUNDARY (why [1] ships as a check + an installer, not an installation):** installing or loading
a LaunchAgent writes OUTSIDE the project, which the standing rule forbids this agent from doing,
and `pm2 startup` surfaces a privileged `sudo env` line that must be seen and consented to rather
than buried in a script. Turning an invisible hole into a visible one is the part that is mine.

## Spec

- **[4] Resume the conversation on wake.** The boot-restore path must relaunch each agent with its
  prior transcript when one exists — gated on `hasPriorConversation` so a first-ever launch is
  unaffected, and confined to clients whose resume flag is known (`lib/client-capabilities.ts`).
- **[2] Never permanently give up.** pm2 must keep retrying a crash-looping server with
  exponential backoff instead of stopping after a fixed count.
- **[1] Make the blackout hole visible + one-command fixable.** A self-check at server startup
  reports whether machine-level boot persistence is installed; an in-repo script installs it.
- Do NOT write outside the project directory.

## Acceptance

- [x] A boot-restored agent resumes its PRIOR conversation (not a fresh one) when a transcript
      exists for its workdir, and launches normally when none does — `decideResume` + `boot-restore-service`
      passing `continueConversation: true`; pinned by tests/unit/resume-on-wake.test.ts
- [x] The resume flag is per-client (never a hardcoded `--continue` for a client that lacks it) —
      read from `getClientCapabilities(program).cli.resume`, and subcommand-form verbs are REFUSED
- [x] pm2 retries a crash-looping server indefinitely with backoff rather than stopping at a count —
      `max_restarts: 10000` + `exp_backoff_restart_delay: 1000` in ecosystem.config.js
- [x] The server reports, at startup, whether machine-level boot persistence is installed —
      `lib/boot-persistence.ts` wired into server.mjs beside the boot-restore call; on this host it
      correctly reports `unit-not-loaded`, matching an independent `launchctl` inspection
- [x] An in-repo script installs boot persistence; nothing outside the project is written by the
      agent itself — `scripts/install-boot-persistence.sh`; the privileged `sudo env` line is
      surfaced for the human rather than auto-run

## Approval log

- 2026-07-25T01:04:12+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-25T01:22:35+0200 — COMPLETED. All five acceptance boxes met (18aaf300, 7cbc2ecc, 9d71c3ef).
  Residual, explicitly outside this agent's write boundary: the human loads the already-present pm2
  LaunchAgent (`launchctl bootstrap gui/$UID ~/Library/LaunchAgents/pm2.$USER.plist`).
