---
trdd-id: DPPYVLVH
title: Arm the model-fallback leg and rule on the two rotation-policy questions it routes around
column: proposal
created: 2026-08-06T15:03:40+0200
updated: 2026-08-06T15:03:40+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: user
approved: false
derived: true
derived-kind: eht
parent-trdd: IALQ43QP
priority: 1
severity: high
effort: small
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [oauth-rotator, fleet-watchdog, actuation, user-decision]
npt: []
eht: []
blocked-by: []
external-refs: [Emasoft/ai-maestro-janitor#222]
---

# Arm the model-fallback leg, and rule on the rotation policy it routes around

## Why this is its own card

`TRDD-IALQ43QP` built the model-scoped fallback and landed it **dark**. That work was Tier 0 —
in-scope, reversible, inert until a flag is set — so it needed no approval and got none.

What it CANNOT do is arm itself, and that is not a scheduling detail:

> **No test in the repo can prove the confirming ENTER actually dismissed Claude Code's dialog.**
> The tests prove the keystroke is SENT. The failure mode of being wrong is a fleet of agents
> parked on unanswered dialogs — worse than the exhausted window the feature exists to fix.

So the first switch must be WATCHED by a human on a real pane. That is a USER act, which makes it
a different atomic task from building the code, with a different approver. It is registered as the
parent's **EHT**: the parent shipped a capability nobody has turned on, and this closes that hole.
Until it is terminal the parent is `blocked` — which is the honest reading of "built, unproven".

## The arming procedure

1. Set `AIM_FLEET_MODEL_FALLBACK=1` for the server process.
2. Ensure exactly ONE agent is running Fable (check its pane statusline: `🤖 Fable 5 v…`).
3. Watch the watchdog log for:
   `[FleetLiveness] model-fallback SWITCHED <id> off Fable 5 (NN%) — confirmed=true`
4. Confirm the pane statusline now reads Opus.

**If it reports `confirmed=false`** the ENTER did not take: the agent is parked on the dialog.
`CONFIRM_DELAY_MS` (3 s, `lib/oauth-rotator/model-fallback.ts`) is the first knob — the dialog has
to be DRAWN before it can be answered.

**If it reports `confirmed=unknown`**, the verifier could not read the pane. That is not success;
it means nothing is known beyond "keystrokes were sent".

## The two policy questions — the fallback ROUTES AROUND these, it does not fix them

### 1. `isSafeAlternate` disqualifies an account maxed on a model-scoped window

`lib/oauth-rotator/tick.ts:349` — `bfh < SAFE_5H && bsd < SAFE_7D && (scoped === null || scoped <
SAFE_SCOPED)`. So an account at 5h 42% / 7d 60% with Fable 98% is refused as a rotation TARGET for
the ~123 h until Fable resets, though it serves every non-Fable request perfectly.

**This is the original defect behind the manual rotation of 2026-08-06.** The fallback makes the
symptom survivable; it leaves the cause in place.

It is a USER decision because it is a behavioural change to credential rotation AND the janitor's
`rotator.py` implements the same policy — a fix must land coherently in both, or the two subsystems
disagree about which account is usable, which is worse than either policy alone.

### 2. A dead-refresh LIVE account can never produce `reauth-needed`

`nextAction` derives it solely from `surveyAlternates()`, which **skips the live account** —
`tick.ts:142` documents this ("a LIVE credential that is expiring is invisible to it"). So a live
account with `refresh_failures: 3` falls through to `stuck: all-maxed`, which tells a reader to
*wait for a window* when the actual remedy is *re-login*. Two opposite instructions.

The exclusion is deliberate and its rationale has not been read, so this is a question before it is
a fix: is the live account skipped because refreshing it is unsafe mid-flight, or only because
nothing needed it before?

## Verification

- Arming: the live observation in step 3-4 above. Nothing else can substitute.
- Policy questions: whatever the USER rules; each becomes its own TRDD if it changes code.

## Estimated risk

**Arming: MED** — the leg types into live agent panes. Bounded by the master flag, the machine-wide
STOP gate, HID presence, the per-agent cooldown, and the post-condition pane re-read.
**Leaving it dark: LOW but not zero** — the next model-scoped exhaustion repeats 2026-08-06 by hand.

## Acceptance

- [ ] USER arms `AIM_FLEET_MODEL_FALLBACK=1` and observes one switch reach `confirmed=true`
- [ ] USER rules on `isSafeAlternate` (and, if changed, the janitor half is coordinated)
- [ ] USER rules on the dead-refresh live account
- [ ] Parent `TRDD-IALQ43QP` unblocked once this is terminal

## Approval log

- 2026-08-06T15:03:40+0200 — Authored as a proposal at `min-approval-requirement: user`. Not
  self-mandated: an agent cannot approve its own arming of a fleet actuator, and the two policy
  questions change credential-rotation behaviour shared with another repo.
