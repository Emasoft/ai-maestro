---
trdd-id: 7YRXXKE8
title: PID reuse is closed for the peer and open for every ancestor the identity walk touches
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
priority: 0
severity: high
labels: [security, impersonation, agent-auth]
external-refs: [TRDD-EVO7T245]
---

## Problem

TRDD-EVO7T245 retired PID reuse as a concern with this reasoning: *"the credential is read
from a LIVE connection, so the peer process necessarily still exists while the lookup
happens. There is no window in which a recycled PID answers for a dead one."*

That is TRUE of the PEER pid and FALSE of everything else the lookup touches.

## The gap

Identity resolution is `peer PID -> walk ppid chain -> pane_pid -> tmux session -> agent`.
Only the first hop is protected by the connection being live. The ANCESTOR pids in the
walk, and the `pane_pid` the server holds on record, are ordinary integers that the kernel
recycles.

Concretely: agent B's pane exits. Its pid is later recycled by a process inside agent A's
tree. A's descendants now walk up to a pid that the server's records still associate with
B's pane.

## Why it was missed

The card's sentence is correct and answers a narrower question than the one the design
needs answered. A true statement about the peer was read as a statement about the lookup.

## Task

1. INVESTIGATE — read the actual resolution implementation and identify every pid it
   compares or stores.
2. ASSESS — construct the race: kill a pane, exhaust the pid space (or wrap it), observe
   whether a foreign process can be resolved to the dead pane's identity. macOS pid space
   is small enough that wrap is reachable.
3. SAFEGUARD — compare (pid, start-time) PAIRS, never bare pids, at every hop. `kinfo_proc`
   carries `p_starttime`; a recycled pid has a later start time than the record.

## Acceptance

- [ ] Every pid the resolution stores or compares is enumerated.
- [ ] A demonstration of the race, or a reasoned proof it is unreachable on this platform.
- [ ] Resolution rewritten to use (pid, start-time) pairs at every hop.
- [ ] A test that seeds a recycled-pid record and asserts resolution REFUSES it.
