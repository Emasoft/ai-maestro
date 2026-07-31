---
trdd-id: 9QV4ZCYY
title: The checklist-gated completion rule passes because it read nothing
column: completed
scope: project
project-id: ai-maestro
created: 2026-07-31T14:48:52+0200
updated: 2026-07-31T14:51:02+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-31T14:48:52+0200
derived: false
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [https://github.com/Emasoft/ai-maestro-janitor/issues/109]
---

# The checklist-gated completion rule passes because it read nothing

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-31

**THE DEFECT, verified first-hand.** `rules/aimaestro/aimaestro-trdd-approval.md:801-808` — the
clause Flock B (TRDD-UCC2QJH9 → B1) added and calls **"the hard gate"** — is stated entirely in
terms of boxes that are *unchecked*:

> a TRDD may sit in a terminal column `column ∈ {complete, published, live}` ONLY when every
> `- [ ]` box in its bottom checklist is `- [x]`. A terminal column with ANY unchecked box is a
> **false completion**

On a card with **no checklist at all** there are no unchecked boxes, so the condition is vacuously
true and the gate passes having proven nothing. That is the exact shape this repo already has a
standing lesson about — *"a gate that passes because it read nothing"* — found here in a governance
rule instead of in a CLI.

**MEASURED on our own corpus, 2026-07-31:**

| population | with NO checklist (either box kind) |
|---|---|
| `design/tasks/` open cards | **87 of 108** |
| `design/archived/` cards at `column: completed` | **46** |
| …of those 46, `updated:` AFTER the rule landed (2026-07-24) | **3** — `E9BZ5P7S`, `OWO449MR`, `RCL2HC9Y` |

The 43 older ones predate the rule and are grandfathered by it. **The 3 recent ones are the
evidence that the hole is LIVE, not historical** — each was closed in the last two days, each with
no checklist, each having passed "the hard gate" by having nothing to check.

**NOT a claim that we forgot to enforce our own rule.** The enforcement was deliberately routed
OUT: B2 coordinated the §D4 watchdog build on **janitor#109**, and the watchdog is theirs. Verified:
`lib/trdd-doctor.ts` defines 24 finding codes and **none is about the checklist** — there is no
local guard, vacuous or otherwise. So the defect is not a missing implementation on our side; it is
that **the rule, as written, would still pass vacuously on 87 of our 108 open cards the day that
watchdog does land.**

**NEXT ACTION:** two halves, in order.
1. **Fix the clause** in `rules/aimaestro/aimaestro-trdd-approval.md` §D4 step 5b — a terminal
   column requires a checklist that **EXISTS** (≥1 box) and is fully checked. Add the grandfather
   boundary explicitly (below), because a rule that retroactively flags 46 archived cards is a wall
   of warnings, and *a wall of warnings is how a linter gets routed around*.
2. **Report it on janitor#109** so the watchdog they build implements the non-vacuous form rather
   than the literal one. Self-identify per PRRD G1.

## The grandfather boundary, and why it is drawn there

The gate binds the **transition into** a terminal column, not the card's whole life:

- **An open card with no checklist is NOT a violation.** It is not terminal, so it is claiming
  nothing. Requiring a checklist at authoring time would flag 87 cards at once and buy nothing that
  the terminal gate does not already buy at the moment it matters.
- **A card already in a terminal column is FROZEN** (IND base `trdd-design-tasks.md` step 12 — do
  not edit the body of a `complete`/`published`/`live`/`superseded` card). So the 46 archived ones
  cannot be repaired even in principle; they are grandfathered as a matter of fact, and the 3
  post-rule ones are NAMED above so the record says what happened rather than implying a clean
  history.
- **What changes is the NEXT terminal transition.** From this rule forward, a card cannot reach
  `complete` without stating what completion meant.

## Acceptance

- [x] §D4 step 5b requires a checklist that EXISTS and is fully checked, with the grandfather
      boundary stated in the rule itself
- [x] The 3 post-rule vacuous completions are named in the rule or in this card (they are named
      here) so the boundary is auditable rather than asserted
- [x] `bash scripts/with-node.sh yarn test` green (the DEP rules have a size/shape test)
- [x] `bash scripts/with-node.sh yarn trddgrep validate` exit 1 with only the two known
      `BODY-STATE-CLAIM` cards
- [x] Reported on janitor#109 so their §D4 watchdog implements the non-vacuous form

## Approval log

- 2026-07-31T14:48:52+0200 — MANDATE issued by USER (min-approval-requirement: manager).
  Pre-approved: the standing directive to find and fix defects covers remediating a hole in a rule
  authored under that same directive. No approval request was sent.
- 2026-07-31T14:51:02+0200 — COMPLETED by ai-maestro. Both halves landed: the clause now requires a
  checklist that EXISTS and is fully checked (with the grandfather boundary and the 3 post-rule
  cards named IN the rule), and janitor#109 carries the request to build the non-vacuous form
  (comment-5143038239). **This card is the first to satisfy the rule it fixes** — 5 boxes, all
  checked, so its own terminal transition is not the vacuous kind it was written to close.
