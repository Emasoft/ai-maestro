---
trdd-id: 46MY2EX4
title: A local process that resolves to no agent must be refused and never conflated with the system owner
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:09+0200
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
priority: 1
severity: high
labels: [security, impersonation, agent-auth]
external-refs: [TRDD-EVO7T245, TRDD-9JUEJFY3]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:09+0200
---

## Problem

Any local process can connect to the server's Unix socket, not only agents. The identity
resolution must therefore have a well-defined answer for "this pid does not walk up to any
pane" — and that answer must be a refusal.

## Why it needs its own card

It looks like a trivial corollary of fail-closed (TRDD-9JUEJFY3) and it is not: that card is
about a walk that BREAKS, this one is about a walk that COMPLETES and finds nothing. The two
have different code paths and a fix for one does not imply the other. A `null` agent that is
then treated as "system" or "owner" anywhere downstream is a privilege escalation from any
local process on the machine, agent or not.

## Task

1. INVESTIGATE — the socket's path, ownership and mode; who can reach it.
2. ASSESS — what the resolution returns for a non-agent peer, and what every downstream
   consumer does with that value. Specifically: is `undefined` agentId treated as
   system-owner anywhere (lib/agent-auth.ts documents exactly that meaning for a web
   session, which makes the collision plausible).
3. SAFEGUARD — a non-resolving peer is refused, and is never conflated with the web-session
   system-owner case.

## Acceptance

- [ ] Socket path, owner, mode recorded, with a statement of who can connect.
- [ ] The resolution's return for a non-agent peer is specified and refused.
- [ ] A grep-backed audit that no consumer treats an unresolved peer as owner.
- [ ] A test connecting from a non-agent process and asserting refusal.

## Approval log

- 2026-09-05T10:21:09+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  fail-closed-on-no-match for identity walk still unimplemented (no such code exists) . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
