---
trdd-id: CQD0EP6R
title: A scenario runner must never wait — the orchestrator owns the clock, the runner owns bounded UI bursts
column: design
created: 2026-07-23T17:16:52+0200
updated: 2026-07-23T17:16:52+0200
current-owner: ai-maestro-dev-session
task-type: infra
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
severity: critical
effort: medium
release-via: none
relevant-rules: []
labels: [harness-readiness, scen-031, scenario-runner]
implementation-commits: []
---

# The runner must never wait

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-23

- **Three consecutive runner failures on SCEN-031 phase 2, one cause: WAITING.**
  The fleet was healthy through all three.
- **NEXT ACTION:** decide the split (below), then rewrite the phase files so no step
  inside a runner contains "wait for the fleet".
- Do NOT respawn a fourth runner into the current design. It will die the same way.

## The observation

SCEN-031 phase 2 asks a runner to observe an autonomous fleet build software. The
fleet works on **wall-clock hours**. Three runners were given that job today:

| Runner | Died | Last words |
|---|---|---|
| 1 | mid-wait | "I'll pause here and wait for the background wait to complete" |
| 1 (resumed) | mid-wait, 60s later | "Waiting for the 180s window before the next probe." |
| 2 | frozen at `step=S008w`, heartbeat stale 29 min | "PR#4 merged onto main … Let's keep watching for the dispatch" |

None of them was confused. Runner 2's final thought was a *correct* reading of the
run. They did not fail at observing — they failed at **existing long enough to observe**.

Costs: runner 1 burned ~355k tokens per resume cycle to buy ~2 tool calls, because a
resume re-reads the whole transcript. Runner 2 produced no report, no screenshots, and
never advanced past the wake step.

## Root cause

**A subagent that ends its turn is indistinguishable from a subagent that finished.**
So "wait" and "done" are the same event to the harness. Any design that puts a
long wait *inside* a subagent is therefore unstable by construction:

- wait by ending the turn → reported as completed, run abandoned;
- wait by a foreground `sleep` → the harness blocks foreground sleeps;
- wait by a background job → the turn ends anyway, same as the first case.

There is no spelling of "wait quietly for 40 minutes" available to a subagent.

## The insight

The orchestrator CAN wait, cheaply and indefinitely, and was doing so successfully
throughout all three failures — cheap side-effect probes (`gh api`, `tmux
capture-pane`, transcript mtimes) that cost ~1k tokens and add nothing durable to
context. The orchestrator is woken by the janitor heartbeat on its own cadence.

So the two roles have opposite shapes and must not be fused:

| Role | Owns | Shape |
|---|---|---|
| **Orchestrator** | the CLOCK — waiting, polling, deciding when a milestone is reached | long-lived, cheap per probe, woken by heartbeat |
| **Runner** | the UI BURST — drive the dashboard, screenshot the step, assert, exit | short-lived, bounded, never waits |

## Proposed fix

1. **No step inside a runner may say "wait for the fleet".** Split the phase files by
   ACTIVITY, not by scenario stage: each runner invocation is a bounded burst of UI
   steps with a precondition that is ALREADY TRUE when it is spawned.
2. **The orchestrator gates the spawns.** It polls for the milestone (a PR merged, a
   branch pushed, a release cut), then spawns a runner whose only job is to verify and
   screenshot that milestone through the UI, and exit.
3. **A runner that finds its precondition unmet returns immediately** with `BLOCKED:
   <precondition>` rather than waiting for it. Waiting is not its job.
4. **Keep the heartbeat contract**, but treat a stale runner heartbeat as a HARD
   failure of the runner, never of the fleet — the two were repeatedly conflated today.

## Why this is not just an optimization

The phase split (1/2/3) was introduced to cut transcript size, and it did. But it did
not remove the waiting — it only moved it, so phase 2 still contained hours of
fleet-time inside one subagent. The phases addressed cost; this addresses
**survivability**. A runner that cannot outlive the thing it observes cannot report on
it, at any transcript size.

## Verification

- Re-run SCEN-031 with the split above; every runner invocation returns within a
  bounded number of turns with a report, or an explicit `BLOCKED`.
- No runner invocation contains a sleep, a poll loop, or a "wait for" step.
- The orchestrator's probe cost per milestone stays in the ~1k-token range.

## Estimated risk

MEDIUM. It changes how scenarios are authored, so every long-observation scenario needs
its phase files reshaped. It does not change what is being tested — only who holds the
clock.

## Approval log

- 2026-07-23T17:16:52+0200 — MANDATE issued by self (min-approval-requirement: none).
  In-scope test-infrastructure change on this project's own source. No approval request sent.
