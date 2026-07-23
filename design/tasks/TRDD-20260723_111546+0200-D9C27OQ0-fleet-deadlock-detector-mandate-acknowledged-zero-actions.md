---
trdd-id: D9C27OQ0
title: Fleet deadlock detector — a worker acknowledged a mandate but took 0 project actions for N minutes
column: planned
created: 2026-07-23T11:15:46+0200
updated: 2026-07-23T11:15:46+0200
current-owner: session
task-type: feature
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T11:15:46+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/fleet-evaluation/20260723_110953+0200-scen031-fleet-behaviour-eval.md
  - design/tasks/TRDD-20260716_200624+0200-CHN16JXZ-fleet-recovery-liveness-ensure-resume.md
---

## Problem (eval SH-1, P5)
The SCEN-031 RULE-1 deadlock manifested as an infinite POLITE STAND-OFF: the AUTONOMOUS dev replied
"mandate absorbed" then took 0 project actions; the MANAGER conceded and waited; nobody erred and
nothing progressed. The existing continuity substrate did not catch it — the fleet-recovery actuator
(CHN16JXZ) handles an IDLE/frozen agent, but a *logical* deadlock (agent alive, acknowledged, choosing
not to act) is invisible to it. Without a detector this burns indefinitely with no signal.

## Proposed fix (in-repo harness)
Add a **deadlock detector** — either a leg of the server fleet-liveness watchdog or a janitor sweep —
that flags: *an agent AMP-acknowledged a mandate but has produced 0 project-file / git-commit / PR /
branch actions for N minutes* (default N configurable). It surfaces this as an explicit **capability
finding** (logged + optionally an AMP to the MANAGER / a report) rather than a silent stall. This
complements the recovery actuator (idle → nudge) with logical-deadlock detection (acknowledged →
not-acting → flag).

## Verification
Unit-test the detector on a synthetic "acknowledged-but-idle" fixture (an agent with an AMP mandate
reply + zero git/PR activity for > N min → finding emitted); confirm no false positive on an agent
that IS producing commits/PRs, and none on an agent still within its first-think window.

## Estimated risk
LOW-MED. New detector; the false-positive risk (flagging a legitimately-thinking agent) is mitigated by
requiring BOTH an acknowledgement AND a sufficiently long zero-action window, and by making it a
non-actuating FINDING (never a kill).

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
