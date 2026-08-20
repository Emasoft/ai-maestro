---
trdd-id: Z310XDAF
title: Absorb the cold-cache-clear chore via the janitor shell-out launcher
column: complete
created: 2026-08-20T02:00:28+0200
updated: 2026-08-20T19:13:01+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
parent-trdd: KCRMSNL7
npt: []
eht: []
blocked-by: []
implementation-commits: [ab0f2b9c]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the cold-cache-clear chore via the janitor shell-out launcher

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20T02:00:28+0200

- **Lane LANDED, version-gated, inert-unarmed.** `lib/cold-cache-clear.ts` + scheduler in
  `server.mjs` after fleet-stop. The janitor SHIPPED the launcher contract (their
  TRDD-9ZPU69UC, 1d5a3b16, rides v3.3.19): `dispatcher-stub.py --run-cold-cache-clear` —
  argv-only, zero janitor imports; their dispatch flag branch runs ONE beat of the shared
  `cold_cache_clear_task.run_once` and passes rc through.
- **Version gate per beat:** the flag branch exists only from 3.3.19 — a pre-3.3.19 dispatch
  treats the argv as noise and fires a FULL heartbeat turn (their warning, verbatim). Every
  beat probes the NEWEST cached dispatch.py (numeric semver sort — 3.3.19 > 3.3.9) and,
  absent the flag, releases the claim and does nothing. The cache auto-rolls, so the lane
  self-activates when 3.3.19 lands — no restart.
- **Unarmed = full no-op** (not detect-only): their beat has no read-only half — "what would
  be cleared" is decided inside code that ACTS. AIM_COLD_CACHE_CLEAR=1 arms.
- **Claim is DYNAMIC** (per beat): armed + flag present ⇒ mark; flag absent ⇒ unmark. Their
  daemon yields the tick we claim (pinned by their test); the per-project clear cooldown is
  the double-ownership backstop either way.
- **NEXT ACTION (USER, optional):** arm with AIM_COLD_CACHE_CLEAR=1 once v3.3.19 is cached
  (their opt-in external_clear.enabled() ALSO gates inside the beat — double default-off).

## Acceptance

- [x] shell-out contract implemented argv-only (no janitor imports); rc passed through and logged
- [x] version gate: pre-3.3.19 cache ⇒ no spawn AND claim released (their full-heartbeat warning honored); numeric sort pinned (3.3.19 > 3.3.9)
- [x] stamp on attempt; claim dynamic per beat; conditional chore registered
- [x] tests 9/9 with gate-order pins; neuter runs recorded in the test file

## Approval log

- 2026-08-20T02:00:28+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], server-internal,
  dark-shipped — inert until armed AND the janitor's own opt-in enables the beat). No approval
  request sent.
- 2026-08-20T19:13:01+0200 — COMPLETED by hub-session (min-approval-requirement: none). The lane is
  built and pinned (4/4 acceptance, `ab0f2b9c`); the only open item was the STATE block's optional
  arm, and it is DECIDED: **do not arm now.** Measured, not assumed: the janitor's inner opt-in
  `CLAUDE_PLUGIN_OPTION_EXTERNAL_IDLE_CLEAR_ENABLED=true` is LIVE in this environment, so the chore
  runs today under the janitor daemon — arming transfers OWNERSHIP of a chore that clears live agent
  SESSIONS (external_clear.py: idle + >=150k context + next fire misses the TTL), it does not enable
  a new capability, and `lib/cold-cache-clear.ts` states unarmed is a full no-op with the daemon
  "executing the chore exactly as today". Against that zero behavioural gain stands a
  `pm2 restart ecosystem.config.js --update-env` (a plain restart replays cached env, so arming
  cannot take effect without it) across 20 live sessions whose PTY streams this server owns. A
  latent arm staged in `ecosystem.config.js` was also rejected: it would flip ownership at whatever
  unrelated restart came next, with nobody able to connect cause to effect. Arm deliberately during
  a planned restart; the lane self-activates from the cache with no code change (v3.3.19 verified
  cached).
