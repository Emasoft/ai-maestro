---
trdd-id: K5X9WYEJ
title: A connected socket carries its peer credentials so an agent can hand another agent its identity
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
labels: [security, impersonation, agent-auth]
external-refs: [TRDD-EVO7T245]
---

## Problem

Kernel peer credentials are captured at `connect(2)`. Once a connection is authenticated as
agent B, the FILE DESCRIPTOR carries that authentication — and a file descriptor is passable
between processes over a Unix socket via `SCM_RIGHTS`.

So B's process connects (honestly, kernel-attested), then hands the connected fd to A. A now
holds a channel the server believes is B, indefinitely, with no forgery anywhere.

## Why this is the load-bearing argument for channel enumeration

Descriptor passing is why ONE missed channel between agents is fatal rather than
incremental. Every other confinement rule is about preventing A from ACTING as B; this one
lets B hand A the result of B acting as itself. It also means a compromised or merely
careless agent can delegate its identity without the server ever seeing an anomaly.

## Task

1. INVESTIGATE — confirm on this platform that a connected UDS fd retains its peer
   credentials for the RECEIVING process (i.e. that the server still reports B). Positive
   control mandatory: prove the fd works at all after passing.
2. ASSESS — enumerate every channel over which A and B could exchange a descriptor,
   given the confinement rules from the sandbox card.
3. SAFEGUARD — consider re-verifying peer credentials per REQUEST rather than per
   connection, or binding the connection to a nonce the server re-checks. Decide whether
   `LOCAL_PEERPID` is re-readable mid-connection and whether it reports the ORIGINAL peer
   or the current holder — this single fact decides the fix.

## Acceptance

- [ ] A measured answer to whether a passed fd retains the original peer credentials.
- [ ] A measured answer to whether peer credentials can be re-read per request.
- [ ] Every A-to-B descriptor-passing channel enumerated under the confinement rules.
- [ ] A safeguard implemented, or a written argument that no channel remains.
