---
trdd-id: SPS63XHA
title: R39.5 and R39.7 are marked ENFORCED but their guards encode the pre-2026-07-22 rule
column: proposal
scope: project
project-id: ai-maestro
created: 2026-07-29T20:44:27+0200
updated: 2026-07-29T20:44:27+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: manager
mandate: false
approved: false
derived: false
priority: 1
severity: major
effort: small
release-via: none
relevant-rules: [39]
npt: []
eht: []
blocked-by: []
external-refs: []
---

# R39.5 and R39.7 are marked ENFORCED but their guards encode the pre-2026-07-22 rule

Found while scoping #67 batch 2 — I was about to write a drift-failing test for both and
stopped, because the test would have pinned a guard that does not implement the rule as
currently written. **A green row is a claim; pinning the wrong behaviour makes the claim
worse, not better.**

## The divergence, both directions

| | rule text (GOVERNANCE-RULES.md, refined 2026-07-22) | `lib/communication-graph.ts` |
|---|---|---|
| **R39.5** ASSISTANT outbound | own user **+ the MANAGER** — "the single agent it may exchange messages with (R39.9)". The text explicitly says it obeys "no one else — **not the MAESTRO user**, no other agent" | `:364-365` — `as.recipientIsOwnUser \|\| as.recipientIsActiveMaestro`. `AssistantSenderContext` (`:64-66`) has **no `recipientIsManager` field at all** |
| **R39.7** ASSISTANT inbound | invisible to other agents **EXCEPT the MANAGER** (sole agent that may reach it, R39.9), **plus** any collaborator the MANAGER assigns (R39.10) | `:118` — `'assistant': new Set([])`, and it is never a recipient in any other row. **Nothing** reaches it, MANAGER included |

So the code is wrong in **both** directions relative to the current text: it grants a
MAESTRO channel the text does not, and withholds the MANAGER channel the text does.

`assistantSender` appears in **no other file** — there is no second branch implementing the
MANAGER carve-out elsewhere. Verified by grep across `lib/`, `services/`, `app/`.

## Why this is a real reporting defect, not just unfinished work

The map already records **R39.9 and R39.10 as `UNENFORCED`** — which is this same gap seen
from the other end, and is honest. But **R39.5 and R39.7 read `ENFORCED` unqualified**, and
each of those rule texts now *contains* the carve-out that R39.9/R39.10 describe. A reader
of the map sees two green rows and two red ones and cannot tell that the green rows are
green only for the half of their text that predates the refinement.

This is the shape the enforcement map exists to prevent: a rule whose row says ENFORCED
while the guard enforces a superseded version of it. It is invisible to the ratchet (the
citation names real code doing real work) and invisible to a test (a test written against
the code would pass, and would then *certify* the divergence).

## What must NOT happen

- **Do not "fix" it by writing a test.** That is what would have happened here if I had
  taken the two easy ratchet points.
- **Do not edit the rule text or the graph unilaterally.** Which side is authoritative is a
  governance decision, not a defect judgement — the plan is explicit that a test batch must
  not smuggle a governance change in. Hence `min-approval-requirement: manager`.

## The decision the MANAGER owns

Exactly one of these, and each has a different blast radius:

1. **The text is authoritative** → implement the MANAGER channel (add `recipientIsManager`
   to `AssistantSenderContext`, add the inbound MANAGER→assistant edge, decide what happens
   to the MAESTRO channel the code currently grants) and then R39.9 stops being UNENFORCED.
2. **The code is authoritative** → the 2026-07-22 refinement is walked back in the text, and
   R39.9/R39.10 are re-scoped or dropped.
3. **Both, staged** → keep the current guard, but downgrade R39.5/R39.7 in the map from
   ENFORCED to a partial verdict so the row stops overstating, until (1) lands.

Whichever is chosen, the MAESTRO channel needs an explicit ruling: the text says the
ASSISTANT obeys "not the MAESTRO *user*", and the code lets it message exactly that.

## Acceptance

- [ ] The MANAGER rules which of the three above holds, recorded in this card's Approval log
- [ ] The chosen side is implemented, and R39.5/R39.7's map rows say something TRUE of the
      guard as it then stands (ENFORCED with a test, or a partial verdict)
- [ ] R39.9/R39.10's UNENFORCED rows are re-evaluated in the same pass — they are the other
      half of this same gap and must not be left describing a state that changed
- [ ] Whatever lands carries a drift-failing test with a recorded neuter run

## Approval log

- 2026-07-29T20:44:27+0200 — FILED as a proposal-grade finding by ai-maestro during #67
  batch 2. NOT a mandate: `min-approval-requirement: manager` because resolving it changes
  either a governance rule's text or the comm-graph's shape, and neither is this agent's to
  decide.
