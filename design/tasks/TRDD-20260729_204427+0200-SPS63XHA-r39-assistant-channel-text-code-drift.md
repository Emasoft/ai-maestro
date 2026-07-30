---
trdd-id: SPS63XHA
title: R39.5 and R39.7 are marked ENFORCED but their guards encode the pre-2026-07-22 rule
column: blocked
scope: project
project-id: ai-maestro
created: 2026-07-29T20:44:27+0200
updated: 2026-07-30T13:10:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: manager
approval-datetime: 2026-07-30T12:17:34+0200
derived: false
priority: 1
severity: major
effort: small
release-via: none
relevant-rules: [39]
npt: []
eht: [HW72YBZW]
blocked-by: [HW72YBZW]
pre-block-column: planned
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

- [x] The MANAGER rules which of the three above holds, recorded in this card's Approval log — RULED
      2026-07-30: **the TEXT is authoritative; code may be STRICTER, never LOOSER.**
- [x] **The MAP half is done here; the CODE half is TRDD-HW72YBZW**, per the ruling's own "implementation
      is a separate card". R39.5 and R39.7 are now **CONTRADICTED**, each row naming the drift in full.
      And the ruling's ONE OPEN QUESTION is ANSWERED — by reading R39.5's messaging clause as it
      instructed: `recipientIsActiveMaestro` is a SEPARATE disjunct from `recipientIsOwnUser`, so it is
      a genuinely broader grant, not the misnamed MANAGER channel (`AssistantSenderContext` has no
      `recipientIsManager` field at all). **AND the whole branch is UNREACHABLE** — `assistantSender`
      is built ONLY in tests, so at runtime an ASSISTANT sender always hits the fail-closed deny. The
      hole is LATENT, not live, which is why the edge was left in place exactly as the ruling directed.
      (superseded box text: the chosen side is implemented, and R39.5/R39.7's map rows say something TRUE of the
      guard as it then stands (ENFORCED with a test, or a partial verdict)
- [x] R39.9/R39.10's UNENFORCED rows are re-evaluated — already TRUE, and the rules doc's own 4.7.0
      changelog says so ("code stays stricter than the rule"): the empty `'assistant'` edge set IS the
      documented interim state. Nothing to walk back. (was: they are the other
      half of this same gap and must not be left describing a state that changed
- [x] Whatever lands carries a drift-failing test with a recorded neuter run — TWO landed in
      `tests/unit/communication-graph-user-routing.test.ts`: (a) the R39.9 gap is now a live assertion
      that reddens when the channel is built, and (b) a source scan pinning that NO production caller
      builds an `assistantSender` block — the fact that makes the superseded grant harmless, and the
      one that would otherwise stop being true silently. Neuter recorded: adding a real producer to a
      `lib/` file reddens exactly that test (1 failed / 37 passed). The pre-existing
      `ASSISTANT -> active MAESTRO = allow` test was CERTIFYING the superseded shape; it is kept green
      (the branch is unreachable) but re-commented as DRIFT, not as the rule.

## Approval log

- 2026-07-29T20:44:27+0200 — FILED as a proposal-grade finding by ai-maestro during #67
  batch 2. NOT a mandate: `min-approval-requirement: manager` because resolving it changes
  either a governance rule's text or the comm-graph's shape, and neither is this agent's to
  decide.

- 2026-07-30T12:20:00+0200 — **RULED** by manager, under the USER's delegation *"i don't care
  of those details. you solve them."* (recorded verbatim: this is a security boundary, so what
  authorized the ruling must be auditable rather than inferred).

  **THE TEXT IS AUTHORITATIVE. THE CODE MAY BE STRICTER THAN THE TEXT, NEVER LOOSER.** That
  single principle resolves both halves of the drift without needing them to be the same kind
  of defect — and they are not:

  1. **The MISSING `ASSISTANT ↔ MANAGER` channel (R39.9/R39.10) is NOT a defect.** It is code
     being stricter than the text, and the rules doc already says so in its own changelog —
     4.7.0: *"ENFORCEMENT of the ASSISTANT<->collaborator AMP + kanban edges is a pending
     comm-graph build item (code stays stricter than the rule)."* So `'assistant'` holding an
     empty static edge set is the DOCUMENTED interim state, and the map's UNENFORCED rows for
     R39.9/R39.10 are already telling the truth. Nothing to walk back; this is a build item.
  2. **The `ASSISTANT → MAESTRO` grant is the half that must not stand**, because it is the
     one direction the principle forbids: code LOOSER than the text. R39.5 as tightened on
     2026-07-22 names the obedience set as *its own user unconditionally* plus — only with the
     user's explicit permission — *the MANAGER*, and says outright that it does **NOT** obey
     the MAESTRO USER, who administers only the 4 locked identity fields via the UI (R39.4).

  **AND the map rows for R39.5/R39.7 are DOWNGRADED from ENFORCED**, because they cite code
  that encodes the pre-2026-07-22 shape. A citation naming real, working code that enforces a
  SUPERSEDED version of a rule is invisible to every instrument we have — the ratchet sees a
  live guard, and a test written against that guard PASSES and thereby certifies the
  divergence. That is the failure mode this whole re-citation campaign exists to catch, and
  R39.5/R39.7 are two easy ratchet points that would otherwise have laundered a refinement out
  of existence.

  **ONE QUESTION IS DELIBERATELY LEFT OPEN, and the edge stays until it is answered.**
  `AssistantSenderContext.recipientIsActiveMaestro` is cited to R37.2 (the *acting* MAESTRO),
  and obedience is not the same relation as reachability — "does not OBEY the MAESTRO USER"
  does not by itself forbid *messaging* them. Two readings survive the evidence I gathered:
  either the field means the human MAESTRO (a channel the text does not grant), or it is the
  MANAGER channel under the retracted name *"the MAESTRO agent"* that 4.7.1 reverted (in which
  case it is R39.9, misnamed, and finding (1) above is wrong in the other direction). **Do not
  delete the edge on the strength of either reading.** Read R39.5's *messaging* clause in full
  first — deleting a channel a rule requires is worse than leaving one a rule merely fails to
  mention, and this exact "confident reading of the code beats the instrument" move produced a
  false positive in this repo before (the `TITLE_PLUGIN_MAP` shadow).

  Implementation is a separate card, not this one: this card's question was *which side is
  authoritative*, and that is now answered.
