---
trdd-id: IALQ43QP
title: Automatic fallback when a model-scoped window is exhausted but the account has headroom
column: blocked
pre-block-column: testing
created: 2026-08-06T15:01:34+0200
updated: 2026-08-06T15:08:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T15:01:34+0200
priority: 1
severity: high
effort: medium
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [oauth-rotator, fleet-watchdog, actuation, ships-dark]
npt: []
eht: [DPPYVLVH]
blocked-by: [DPPYVLVH]
implementation-commits: [c4805975, 7effa4aa, b00b447d, f9c92837, dec2d777, aa10c921, 3846c840, 68b6ab85, 63f1335f, 1fa79385, fc58aa52, 59022e79, 976fa045, f257600f, c053736f]
external-refs: [Emasoft/ai-maestro-janitor#222]
---

# Automatic fallback when a model-scoped window is exhausted

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-06

**The code is COMPLETE, WIRED, and SHIPPING DARK. The only remaining step is the USER arming it.**

- Full unit suite at the time of writing: **250 files / 3283 tests / 0 failures**, `tsc` 0.
- 19 recorded neuter runs across the five modules; every one matched its prediction.
- Flag: `AIM_FLEET_MODEL_FALLBACK=1`. Unset today, pinned by a neutered default-OFF test.

**NEXT ACTION (USER's, not an agent's):** arm the flag, keep one agent on Fable, and watch the
watchdog log for `model-fallback SWITCHED … confirmed=true` plus the pane statusline flipping to
Opus. If it reports `confirmed=false`, the ENTER did not take and `CONFIRM_DELAY_MS` (3 s) is the
first knob.

**Why an agent must not arm it:** no test in this repo can prove the confirming ENTER actually
dismissed Claude Code's dialog — the tests prove the keystroke is SENT. The failure mode of being
wrong is a fleet parked on unanswered dialogs, which is worse than the exhausted window.

**SUPERSEDED — do NOT carry forward:** any note saying the planner/actuator/deps/sweep is
"not wired yet". All five modules and the watchdog leg landed on 2026-08-06.

## Problem

A **model-scoped** window can be spent while the ACCOUNT still has most of its capacity. Measured
2026-08-06 on the live account: 5h **42%**, 7d **60%**, Fable **~98%**.

The rotator's response was to evict the whole fleet onto alternates at 99% (5h) and 87% (7d), and
then refuse to return — `isSafeAlternate` (`lib/oauth-rotator/tick.ts:349`) disqualifies an
account maxed on ANY window, including one that binds a single model. That is a ~123 h lockout on
an account serving every non-Fable request perfectly. The owner recovered by hand, and the manual
fix was one keystroke sequence.

**Rotating the credential is the expensive answer to a MODEL limit. Switching the model is the
cheap one.**

## Root cause

Two facts that only became visible while building this:

1. **The two beats are disjoint.** `lib/oauth-rotator/tick.ts` has the window numbers and **zero**
   agent references; `lib/fleet-liveness-watchdog.ts` has the agents and no credential access.
   Before this work the persisted stamp carried `{nextAction, at, stuck}` and no numbers, so the
   only subsystem able to act on a Fable window could not see one.
2. **No source reported an agent's running model.** Measured: `Agent.model` **null for all 13**
   live agents, no `--model` in `programArgs`, and **0 of 419** hook chat-state files carry a
   `model` key. The one place it exists is the pane statusline.

## Proposed fix — as built

| module | role |
|---|---|
| `lib/oauth-rotator/model-fallback.ts` | pure planner: who, when, or a NAMED skip |
| `lib/oauth-rotator/model-fallback-actuator.ts` | one gated switch: ESC → command → settle → ENTER |
| `lib/oauth-rotator/model-fallback-deps.ts` | real keystrokes + `readPaneVerdict` verifier |
| `lib/oauth-rotator/model-fallback-sweep.ts` | one switch per beat, paced, stateless |
| `lib/fleet-liveness-watchdog.ts` | the leg; reads windows via `readTickWindows` |

Plus the cross-beat join: `WindowSnapshot` on the tick result (threaded on the SAME additive
out-param `stuck` already uses, per TRDD-RFQFCCU4) and persisted validated into the stamp.

**Design decisions that are load-bearing, each with the reason it is not arbitrary:**

- **`/model opus` does not switch the model.** Claude Code raises an AskUserQuestion and the switch
  lands only on ENTER (USER, 2026-08-06). A sweep that types the command and walks away leaves the
  agent BLOCKED on a dialog — worse than the state it repairs, fleet-wide.
- **60 s between agents** (USER's number, rate-limit ban avoidance), enforced INSIDE the sweep
  rather than trusted to the beat cadence, which changes without anyone reading this file.
- **The candidate list drains itself**, so no plan is persisted and the beat is never slept: a
  switched agent stops reporting the exhausted model on the next pane read.
- **Cooldown is the only PER-AGENT gate**, so the sweep iterates past it and stops dead on every
  fleet-wide refusal. Without this one agent whose switch failed to take blocks the entire fleet
  for the cooldown window.
- **A null account window counts as EXHAUSTED**, never healthy — the fail-open shape is what let a
  stuck rotator report `ok` for 3.7 days.

## Verification

- `bash scripts/with-node.sh npx vitest run tests/unit/` → 250 files / 3283 tests / 0 failures.
- `bash scripts/with-node.sh npx tsc --noEmit` → 0 lines.
- 19 neuter runs recorded in the five test files, each naming the tests it reddened.

## Estimated risk

**MED, and entirely concentrated in the arming.** While dark the leg performs no I/O at all. Once
armed it types into live agent panes; the blast radius of a mis-sent keystroke is a fleet parked on
dialogs. Mitigated by: default-OFF, the shared machine-wide STOP gate, HID presence, the per-agent
cooldown, and a post-condition that re-reads the pane.

## Open questions — USER decisions, NOT agent-decidable

1. **`isSafeAlternate` disqualifies an account maxed on a model-scoped window.** This is the
   ORIGINAL defect behind the manual rotation; this TRDD routes around it rather than fixing it. A
   fix is a behavioural change to credential rotation, and the janitor's `rotator.py` implements
   the same policy — it must land in both or the two disagree about which account is usable.
2. **A dead-refresh LIVE account can never produce `reauth-needed`** — `nextAction` derives it
   solely from `surveyAlternates()`, which skips the live account by design (`tick.ts:142`
   documents this). So a live account with `refresh_failures: 3` falls through to
   `stuck: all-maxed`, pointing at *wait for a window* when the remedy is *re-login*.

## Acceptance

- [x] Planner, actuator, deps, sweep, and the watchdog leg landed with tests
- [x] The cross-beat window join persisted and stale-gated
- [x] Every guard neutered, each run recorded with the tests it reddened
- [x] Ships dark, with the default-OFF guarantee itself neuter-verified
- [x] Findings shared with the janitor for the out-of-harness half (#222)
- [x] The arming + the two policy rulings registered as an EHT (`TRDD-DPPYVLVH`)

Every box here is checked and this card still is NOT `complete`: its EHT is open, and a parent
whose flock is unfinished is `blocked`, not done. The build shipped a capability nobody has turned
on — that hole is what `DPPYVLVH` closes.

## Approval log

- 2026-08-06T15:01:34+0200 — Authored. **Self-mandate, Tier 0**: the work is in-scope, reversible
  and inert until a flag is set, so it needed no approval and got none.
- 2026-08-06T15:08:00+0200 — Corrected by this project's own linter, which is worth recording
  because I wrote the defect. The card first said `approved: false` with `column: human_review`,
  and `trddgrep validate` raised APPROVAL-UNAPPROVED-IN-WORK-ZONE: *"the card sits in the
  authorized-work set while asserting nobody approved it"*. It was right. The confusion was mine —
  I had folded two atomic tasks into one card. The BUILD was self-mandated and is done; the
  ARMING needs the USER and is now `TRDD-DPPYVLVH`, an EHT. This card moves to `blocked` on it.
