---
trdd-id: 7J6RIOU1
title: The interrupt action must carry the injection mark or it reopens the presence forgery
column: cancelled
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-21T22:00:37+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:00:37+0200
severity: high
effort: small
derived: true
derived-kind: eht
parent-trdd: GY4CLHCA
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [daemon, presence, injection, ai-maestro-117]
external-refs: [Emasoft/ai-maestro#60, Emasoft/ai-maestro#117]
---

# The interrupt action must carry the injection mark or it reopens the presence forgery

## Problem

This is the hole [[GY4CLHCA]] opens, which is why it is an EHT and not a bullet inside it.

ai-maestro#117 fixed a bug in which every server-injected prompt was reported as **human presence**
by the target's `UserPromptSubmit` hook, so `fleet-recovery-runner` deferred — meaning the daemon's
own recovery prompt would tell the fleet a human was at the keyboard and stand recovery down. Since
presence is a **single global record**, one such miss stands recovery down for everyone.

The fix marks what the server injects, at three surfaces: `sendCommand`, `sendAgentSessionCommand`,
and (caller-conditionally) `sendChatMessage`. **A new interrupt action is a FOURTH injection surface**
and would be unmarked on arrival — reintroducing the exact forgery through the new door, in the one
subsystem whose entire purpose is recovering agents that recovery has been told to skip.

## Proposed fix

Mark after a successful interrupt, exactly as the other three do: `injectedPrompts.set(sessionName,
Date.now())`, **after** the send, never beside an activity bump.

Two properties to preserve, both easy to get backwards:

- **Positive evidence only.** No mark ⇒ record presence as before. Inferring "not human" from a
  missing mark makes recovery race a live user — worse than the bug being fixed.
- **Consume-once.** The mark is deleted as it is spent; a time window would keep vetoing genuine
  keystrokes that merely follow an injection.

Open sub-question for whoever builds it: an interrupt is a control signal, not a prompt, so it may
produce **no** `UserPromptSubmit` echo at all. If so the mark is never consumed and expires via
`INJECTION_ECHO_MAX_AGE_MS` — harmless, but it should be a deliberate decision recorded in the code,
not an accident. Measure whether the echo arrives before choosing.

## Verification

Complementary neuter pair, each reddening a **different** named test: delete the mark (the
"interrupt marks the pane" test reds), and make it unconditional/misplaced (the "a refused or failed
interrupt leaves no mark" test reds). A single neuter would leave half the behaviour unpinned — the
pattern that already caught a mislabelled guard on #117.

## Estimated risk

LOW in code, HIGH if omitted: the failure is silent and global, and its symptom — recovery
mysteriously declining to act — points at the recovery logic rather than at the mark.

## Approval log

- 2026-08-21T22:00:37+0200 — **CANCELLED as OBSOLETE (min-approval-requirement: manager)** by
  ai-maestro-hub-session. Re-measured first-hand: `interruptSession`
  (`services/sessions-service.ts:1419`, landed in commit `01747710`,
  "the daemon principal and a synchronous interrupt primitive", 2026-08-06) already sets
  `injectedPrompts.set(sessionName, Date.now())` **before** the observation window, and does so
  only on the success path (after `sessionExists`/authz/`sendKeys`), preserving positive-evidence-
  only. `tests/services/interrupt-session.test.ts` pins it with the exact complementary-neuter
  pattern this card's `## Verification` prescribed (comment block cites both neuter runs against
  the pre-revert file: dropping the raw-key send, and dropping the mark, each reddening a
  different named test). The fix this card asked for shipped one day after filing, under
  `parent-trdd: GY4CLHCA`'s implementation. Nobody declined the need; it was met. Cancelled per
  the archival protocol, not refused.