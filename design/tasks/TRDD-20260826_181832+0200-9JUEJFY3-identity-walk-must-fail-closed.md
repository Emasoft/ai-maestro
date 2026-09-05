---
trdd-id: 9JUEJFY3
title: A severed ancestry walk must fail closed because every plausible fallback is agent-forgeable
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:21+0200
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

- [ ] Walk-failure behaviour is specified and implemented as a refusal.
- [ ] The refusal is covered by a test that a fallback would redden.
- [ ] Legitimate detached callers enumerated, each with its non-heuristic path.
- [ ] A comment at the refusal site stating WHY no fallback may be added, citing this card.

## Approval log

- 2026-09-05T10:21:21+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  fail-closed on severed identity walk still unimplemented . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
