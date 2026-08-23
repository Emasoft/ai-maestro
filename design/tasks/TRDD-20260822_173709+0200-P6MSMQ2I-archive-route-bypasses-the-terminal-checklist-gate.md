---
trdd-id: P6MSMQ2I
title: archive route bypasses the terminal checklist gate
column: testing
created: 2026-08-22T17:37:09+0200
updated: 2026-08-23T11:14:29+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:37:09+0200
npt: []
eht: []
implementation-commits: [da7ec5e8, bba8f1c7]
project-id: ai-maestro
repo: Emasoft/ai-maestro
---

# archive route bypasses the terminal checklist gate

## Problem
`POST /api/trdd/[id]/archive --state completed` moves a card with NO acceptance checklist at all
into `archived/completed`. The completion gate — a terminal column requires a checklist that EXISTS
(>=1 box) and is fully ticked — is enforced by the LINTER, not by the route performing the
transition. So the API mints exactly the false completion that gate exists to prevent.

Measured 2026-08-22 (TRDD-798OAHMX e2e): card `G6A54OYK` was archived this way and
`trddgrep validate` now reports a standing `TERMINAL-WITHOUT-CHECKLIST` ERROR against it. That card
is left in place deliberately as the live reproduction; it is terminal and therefore frozen, so it
must not be "repaired" by adding ticked boxes for work nobody did.

## Proposed fix
Enforce the same predicate in the archive route that the linter applies: refuse a terminal
transition when the card carries no acceptance checklist or any unticked box.

## Verification

Archive a checklist-less card via the route; expect a refusal naming the gate.

> **⚠ THE SECOND HALF OF THIS SECTION WAS UNSATISFIABLE AS WRITTEN, and it contradicted this
> card's own `## Problem`.** It asked for *"`trddgrep validate` clean afterwards"*. That cannot
> happen: `## Problem` deliberately RETAINS `G6A54OYK` as the live reproduction, and `G6A54OYK`
> sits in `design/archived/` with `column: completed` and — measured 2026-08-23 — **zero**
> acceptance boxes. No route guard can remove a card that is already terminal, and repairing it
> is forbidden two paragraphs up (terminal cards are frozen, IND rule 12). So the two halves of
> this card asked for opposite things, and whoever implemented it had to notice before
> "achieving" clean by deleting the evidence for its own bug.
>
> **Resolved by reading it as it was meant:** the gate is verified by the route REFUSING, and by
> `trddgrep validate` gaining **no NEW** `TERMINAL-WITHOUT-CHECKLIST`. Measured after the fix:
> validate reports exactly the same 2 pre-existing ERRORs as before (`G6A54OYK`, and an unrelated
> `BODY-STATE-CLAIM` on `7123D51A`) — unchanged, which is the correct outcome.

## Implementation 2026-08-23

Landed as `da7ec5e8`. `rejectIncompleteChecklist` in `lib/trdd-authz.ts`, called from
`app/api/trdd/[id]/archive/route.ts` beside the existing `rejectUnarchivableState`, and BEFORE
authorization — an unfinished card is not archivable by anyone, the owner included, so it is not
a permission `authorize()` could grant.

It reuses `countAcceptanceBoxes`, the LINTER'S OWN counter, rather than a second regex. Two
spellings of "an acceptance box" would drift, and silently in the worst direction: the route
would admit a card the linter then rejects — this bug wearing a different hat. It inherits the
counter's fenced-block handling for free, which is load-bearing because a card DOCUMENTING this
rule contains example checkboxes.

`cancelled` and `superseded` are NOT gated, matching the linter exactly: open boxes are what
those columns MEAN, and demanding a full checklist from abandoned or overtaken work would make
the honest closure of a dead card impossible.

**Not in `archiveTrdd`, despite the store being the tempting single choke point.**
`lib/trdd-doctor.ts` imports `lib/trdd-store.ts`, so importing the counter back into the store
creates a cycle. Recorded in the guard's own comment so the next reader does not "fix" it into
one. This costs nothing here: `archiveTrdd` has exactly one production caller, and the headless
router reaches it by DELEGATING to the same Next module (`headless-router.ts:4321`), so one guard
covers both surfaces. That was verified rather than assumed — TRDD-8Q5EVGV1 measured the same
night that a Next-only fix is the DEFAULT failure in this repo.

Eight tests in `tests/unit/trdd-archive-checklist-gate.test.ts`, unit-level against a temp corpus
rather than through HTTP: the guard IS the decision, and routing through sudo + auth + a Next
request lets any of those refuse first — the ai-maestro#114 trap, where five different inputs all
returned one 401 and proved nothing about any of them.

Two complementary neuters, OBSERVED: `boxes.total === 0` → `false` reds 2; `boxes.open > 0` →
`false` reds 1, on a disjoint set. The second was written as "2 red" before the run and was
wrong; the correction is left visible in the test header (`bba8f1c7`) because a predicted neuter
count is indistinguishable from a measured one.

## Acceptance

- [x] the archive route refuses `--state completed` for a card with NO acceptance checklist
- [x] it also refuses when a box is still open, naming the count so the caller knows what to fix
- [x] `cancelled` and `superseded` are NOT gated, matching the linter's deliberate exclusion
- [x] the guard uses the linter's own `countAcceptanceBoxes`, not a second implementation
- [x] both surfaces are covered — verified that headless DELEGATES to this same route module
      rather than carrying a twin
- [x] a complementary neuter pair proves neither half of the guard is vacuous, with OBSERVED counts
- [x] `G6A54OYK` is untouched: still terminal, still frozen, still the reproduction. The two
      standing validate ERRORs are unchanged and this card does not claim to fix them

## Approval log

- 2026-08-22T17:37:09+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
