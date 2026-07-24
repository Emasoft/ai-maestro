---
trdd-id: NIU5RQ1S
title: Crash and blackout resume — the server and every agent come back exactly where they left off
column: dev
scope: project
created: 2026-07-25T01:04:12+0200
updated: 2026-07-25T01:04:12+0200
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

### The chain, and where it was BROKEN (grounded 2026-07-25, not assumed)

```
power loss / reboot
  → [1] launchd must resurrect the pm2 daemon        ✗ BROKEN — no LaunchAgent exists
  → [2] pm2 must restart ai-maestro (and keep trying) ~ PARTIAL — gives up after 10 unstable
  → [3] server boot-restore re-wakes active agents    ✓ works (JAU1ES1C hardened it)
  → [4] each agent must resume ITS CONVERSATION       ✗ BROKEN — wakes with a FRESH context
  → [5] something must nudge the resumed agent to act ✓ fleet-recovery actuator (armed)
```

**[1] is the total-failure point and it was invisible.** `boot-restore-service.ts`'s own docstring
asserts "pm2's LaunchAgent brings the AI Maestro server back up" — on this machine
`~/Library/LaunchAgents/` contains **no pm2 entry at all**. The docs (QUICKSTART, OPERATIONS-GUIDE)
correctly tell the user to run `pm2 startup` + `pm2 save`; it was simply never done, and nothing
ever noticed. Every layer below [1] is irrelevant if the server never starts, so a perfect
boot-restore has been sitting behind a door that does not open. (`pm2 save`'s `dump.pm2` DOES exist
— from 2026-07-15 — which is exactly why this looks healthy at a glance: the resurrect LIST is
saved, but nothing runs `pm2 resurrect`.)

**[4] is the gap the USER's sentence is actually about.** `wakeAgent` builds its launch command as
`startCommand + resolveLaunchArgs(...)` and never adds `--continue`. So a boot-restored agent gets
a BRAND-NEW conversation in the right directory — it is alive, it is in the right repo, and it has
forgotten everything it was doing. That is "restarted", not "resumed". The mechanism already
exists and is proven (`lib/claude-conversation.ts::hasPriorConversation` + the `--continue`
insertion in `lib/session-restart.ts`, TRDD-6AMXSG3S) — it was simply never wired into the wake
path.

**[2] is a smaller, real hole.** `max_restarts: 10` with `min_uptime: '10s'`: a genuine crash-loop
(a bad build, a missing dep) exhausts the budget and pm2 stops trying FOREVER. Live state today is
`restarts=24, unstable=0`, so this has never bitten — but "no matter what interruption" is exactly
the case where it would.

### NEXT ACTION

Fix [4] first (the user's explicit requirement, pure code), then [2] (project config), then [1]
(a project installer + a server-side self-check — see the boundary note below).

**BOUNDARY:** installing a LaunchAgent writes OUTSIDE the project, which the standing rule forbids
this agent from doing. So [1] ships as (a) `scripts/install-boot-persistence.sh` in-repo and (b) a
server startup self-check that DETECTS the missing persistence and says so loudly. Turning an
invisible hole into a visible one is the part that is mine; running the installer is the human's.

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

- [ ] A boot-restored agent resumes its PRIOR conversation (not a fresh one) when a transcript
      exists for its workdir, and launches normally when none does
- [ ] The resume flag is per-client (never a hardcoded `--continue` for a client that lacks it)
- [ ] pm2 retries a crash-looping server indefinitely with backoff rather than stopping at a count
- [ ] The server reports, at startup, whether machine-level boot persistence is installed
- [ ] An in-repo script installs boot persistence; nothing outside the project is written by the
      agent itself

## Approval log

- 2026-07-25T01:04:12+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
