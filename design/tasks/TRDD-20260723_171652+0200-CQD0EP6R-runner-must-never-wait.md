---
trdd-id: CQD0EP6R
title: A scenario runner must never wait — the orchestrator owns the clock, the runner owns bounded UI bursts
column: approval
created: 2026-07-23T17:16:52+0200
updated: 2026-08-25T17:28:11+0200
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

## Acceptance

Added 2026-08-16 — this card had **no acceptance boxes at all** for 24 days, which makes its
completion gate VACUOUS: the gate is "every box checked", and a card with no boxes passes it
having proven nothing. Transcribed from this card's OWN `## Verification` and `## Proposed fix`
lists, not invented at closing time.

- [x] **Rule 15 (`THE-RUNNER-NEVER-WAITS`) is shipped as normative text**, not left as a design
      note — `tests/scenarios/SCENARIOS_TESTS_RULES.md` carries it, and it cites this card by id
      so the reasoning is traceable from the rule.
- [x] **The prohibition is stated so the corpus can actually satisfy it.** It first read *"no step
      may contain 'wait for', 'poll until', 'watch until', or a `sleep`"*. Measured against the
      corpus — **40 scenario files, 1043 `Action` lines, 22 carrying one of those verbs, of which
      about 18 are BENIGN** bounded UI waits (*"wait for the sidebar to render"*, *"Wait for the
      session to start (max 30s)"*, *"Wait for Claude Code idle prompt"*). A rule that flags 18
      things nobody considers wrong is a rule readers learn to skip, which is the failure mode
      this project has already recorded for linters. Reworded to name the real discriminator —
      **does the wait END THE RUNNER'S TURN or span fleet-time** — with the measurement kept in
      the rule so the next editor does not re-broaden it.
- [ ] **No runner invocation waits on the fleet.** MEASURED 2026-08-16 and **2 genuine violations
      remain**, both in `tests/scenarios/SCEN-014_manager-poem-translation-mobile.scen.md` and both
      as step TITLES, i.e. the step's entire purpose is the wait: **S020** *"Wait for the poet to
      write the poem and send it back"* and **S024** *"Wait for the translator to send the Italian
      version back"*. Recorded in Rule 15 rather than silently rewritten — reshaping a scenario's
      phase split is its own task, and a half-edited scenario is worse than a known-nonconforming
      one (Rule 6 invalidates a partially-run scenario anyway).
- [ ] **Re-run SCEN-031 with the split; every runner invocation returns within a bounded number of
      turns with a report, or an explicit `BLOCKED`.** NEEDS A LIVE FLEET — not attainable while
      the fleet is hibernated, and this is the box that would settle the design rather than the
      prose.
- [ ] **The orchestrator's probe cost per milestone stays in the ~1k-token range.** Never measured;
      the figure in `## Verification` is an estimate, and it is recorded as one here rather than
      ticked off as if it had been observed.

## Approval log

- 2026-07-23T17:16:52+0200 — MANDATE issued by self (min-approval-requirement: none).
  In-scope test-infrastructure change on this project's own source. No approval request sent.
