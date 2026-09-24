---
trdd-id: 9JUEJFY3
title: A severed ancestry walk must fail closed because every plausible fallback is agent-forgeable
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-24T10:08:38+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
labels: [security, impersonation, agent-auth]
external-refs: [TRDD-EVO7T245, TRDD-7YRXXKE8]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:21+0200
implementation-commits: [048476cf]
---

## Problem

The identity walk climbs from the connecting pid to its pane. On Unix, when an intermediate
process dies the child is reparented to pid 1 — so the chain to the pane is severed and the
walk fails. An attacker can cause this deliberately (spawn, then kill the intermediate).

**The vulnerability is not the failure. It is whatever the server does next.**

## Why this is the likeliest place for the design to rot

Legitimate agent tooling hits the same path: `nohup`, `setsid`, any daemonised helper, any
process that outlives its spawner. Those callers will fail to authenticate, users will
report it as a bug, and the natural repair is a fallback — resolve by env var, by cwd, by
session name, by process name. **Every one of those fallbacks is forgeable by the agent**,
which converts an unforgeable design into a forgeable one through an ordinary bug fix.

## Task

1. INVESTIGATE — determine the current behaviour on walk failure (there may be no
   implementation yet; then this card constrains the one that gets written).
2. ASSESS — enumerate the legitimate callers that would be reparented, so the fail-closed
   policy is written knowing what it breaks.
3. SAFEGUARD — fail CLOSED, with no fallback, ever. Where a legitimate detached caller
   needs identity, give it an explicit mechanism (an inherited connected socket obtained
   before detaching) rather than a heuristic.

## Acceptance

- [x] Walk-failure behaviour is specified and implemented as a refusal. INVESTIGATED first
  (grep across lib/, services/, app/api/, server.mjs, `services/headless-router.ts` — no
  pid-ancestry-based identity resolution exists anywhere in the codebase; agent auth is
  AID_AUTH-bearer-token-based, delivered via `tmux new-session -e` and inherited through
  fork/exec, immune to reparenting). Per the card's own "then this card constrains the one
  that gets written": added `lib/identity-walk.ts::walkToPane` — a pure, dependency-injected
  choke point with three explicit refusal reasons (`severed`, `unreadable`, `hop-limit`) and
  no branch that resolves identity any other way. Not wired to a caller (none needs it yet);
  it exists so a future caller cannot bypass the fail-closed contract.
- [x] The refusal is covered by a test that a fallback would redden.
  `tests/security/identity-walk-fail-closed.test.ts`. Verified by neuter: changed the
  `severed` return in `walkToPane` to `{ ok: true, panePid: pid, hops }` (the exact
  forgeable-fallback shape this card forbids) — exactly the "a severed chain refuses…" test
  went red (`expected false, got true`), the other 4 tests (incl. the positive control) stayed
  green, then reverted. `bash scripts/with-node.sh npx vitest run
  tests/security/identity-walk-fail-closed.test.ts` — 5/5 pass post-revert.
- [x] Legitimate detached callers enumerated, each with its non-heuristic path. Enumerated in
  `lib/identity-walk.ts` file header: (1) `scripts/aimaestro-statusline-capture.sh`'s detached
  ingest fork — needs no agent identity, gated by `lib/peer-address.mjs::isConsolePeer`
  (kernel-reported loopback origin, not a forgeable identity claim); (2) any hook/detector
  subprocess/heartbeat daemon an agent's `claude` forks inherits AID_AUTH/AIMAESTRO_AGENT from
  the tmux session env set at `-e` time, before it exists — valid independent of the forking
  process's survival; (3) no existing caller derives identity from a live pid chain, so there
  is nothing to migrate onto the walk today.
- [x] A comment at the refusal site stating WHY no fallback may be added, citing this card.
  `lib/identity-walk.ts` — the `walkToPane` docstring plus an inline comment at each of the
  three refusal return statements, all citing TRDD-9JUEJFY3.

## Approval log

- 2026-09-05T10:21:21+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  fail-closed on severed identity walk still unimplemented . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
- 2026-09-24T10:08:33+0200 — COMPLETE by emanuelesabetta. boxes all checked (4/4), sha 048476cf verified merged ancestor of HEAD, no open owner action in STATE/body.
2026-09-24T10:08:38+0200 — closed by ai-maestro-hub-session: boxes all checked (4/4), sha 048476cf verified merged ancestor of HEAD, no open owner action in STATE/body
