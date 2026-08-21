---
trdd-id: WPZP48VV
title: USER-escalation verb — reach the human owner after an approval timeout
column: cancelled
created: 2026-08-20T08:30:48+0200
updated: 2026-08-21T22:00:37+0200
current-owner: ai-maestro-hub-session
task-type: feature
scope: project
project-id: ai-maestro
priority: 2
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:00:37+0200
superseded-by: [P9H0Q7SZ]
---

# USER-escalation verb (--to-user / escalate)

## Problem

AUTONOMOUS ask (2026-08-20): after an approval-request timeout (24h normal / 1h urgent per
manager-approval-defaults) the AUTONOMOUS fallback says escalate to USER — but no verb
reaches the owner; the workaround is an urgent alert to MANAGER "and hope relay".

## Why this is a PROPOSAL, not a mandate

It creates a NEW EDGE in the communication surface: agent → human owner, bypassing MANAGER.
The R6 fallback sanctions it for timeout cases, but WHICH titles get the verb, how the
owner channel is delivered (dashboard notification? push?), and the anti-spam bound
(rate-limit per agent? timeout-proof required?) are governance decisions — Tier 2 floor
(changes the messaging governance surface). Routed to the MANAGER queue; USER may override.

## Proposed shape (for the approver)

`aimaestro-message.sh escalate --subject S --body - [--timeout-of <message-id>]` — server
verifies the caller's AID + title, optionally verifies the cited request is genuinely
timed out (the anti-abuse tooth: an escalation citing a message the MANAGER answered is
refused), delivers to the owner surface, logs the escalation.

## Acceptance

- [ ] MANAGER (or USER) approval recorded here
- [ ] owner-delivery surface decided (dashboard notification exists? measure first)
- [ ] timeout-proof gate decided and spec'd
- [ ] spec first, then implementation; specs:check green

## Approval log

- 2026-08-21T22:00:37+0200 — **CANCELLED as OBSOLETE / duplicate (min-approval-requirement:
  manager)** by ai-maestro-hub-session. Re-measured: `grep -rl escalat design/tasks/` surfaces
  `TRDD-20260819_140156+0200-P9H0Q7SZ-escalate-user-verb-with-ack-state.md` — filed **the day
  before** this card, already `column: design`, self-mandated (`mandate: true, mandated-by:
  user, min-approval-requirement: none`) so it never needed this queue, and actively worked
  (`updated: 2026-08-21T18:12`, STATE block records three corrected premises and a shrunk
  build: an ack record on top of two already-shipped mechanisms —
  `scripts/aimaestro-panel.sh` + `GET /api/agents/[id]/panel/feedback`, TRDD-229CJGYH,
  `column: completed`). Same feature (USER-escalation verb), same problem statement
  (AUTONOMOUS Tier-3 reach-the-owner gap), more advanced. Nobody declined the need; it is
  already being met by P9H0Q7SZ. Cancelled as obsolete, `superseded-by: [P9H0Q7SZ]`.