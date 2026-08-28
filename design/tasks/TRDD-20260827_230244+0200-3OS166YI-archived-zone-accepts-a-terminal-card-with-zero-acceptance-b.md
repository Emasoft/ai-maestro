---
trdd-id: 3OS166YI
title: Archived zone accepts a terminal card with zero acceptance boxes when it bypasses the move verb
column: todo
created: 2026-08-27T23:02:44+0200
updated: 2026-08-28T22:23:12+0200
current-owner: hub-claude
created-by: hub-claude
task-type: bugfix
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T23:02:44+0200
---

# Archived zone accepts a terminal card with zero acceptance boxes when it bypasses the move verb

## Problem
39OPYXQ9 went terminal on 2026-08-26 via a direct git mv, bypassing the archive-route checklist gate P6MSMQ2I built into trddgrep move. trddgrep validate now reports TERMINAL-WITHOUT-CHECKLIST on it. The gate holds for its own route only; the corpus-wide invariant (a terminal card carries >=1 acceptance box, all ticked) is not enforced anywhere a hand-mv can reach.

## Proposed fix
CORRECTED 2026-08-28 — THE PREMISE ABOVE IS WRONG, and the real defect is a different one.

MEASURED: the lint ALREADY EXISTS. `lib/trdd-doctor.ts:895-912` gates `complete|completed|published|live` on `c.boxes.total === 0` at severity **error**, with a 2026-07-31 grandfather boundary, a deliberate `cancelled`/`superseded` exclusion, and a fail-open branch for an unparseable `updated:`. It runs over the WHOLE corpus, so a hand `git mv` does NOT evade it — confirmed live: `trddgrep validate` emits exactly one such ERROR, on 39OPYXQ9. Detection is complete and needs no work.

THE ACTUAL GAP IS THAT NOTHING GATES ON IT. `.githooks/pre-commit` and `.github/workflows/*.yml` contain zero references to `trddgrep`, `trdd:doctor` or `pillars:lint` (grepped, both empty). So the ERROR is advisory: it lands in a validate run currently carrying 261 findings of pre-existing corpus debt, where one more line is invisible in practice. That is why 39OPYXQ9 sat unnoticed.

THE BLOCKER THAT MAKES THIS NON-TRIVIAL, and the reason this card is not just "add it to CI": 39OPYXQ9 is TERMINAL and therefore FROZEN (base rule 12), so it can never be repaired. A blanket gate on this rule would fail every commit forever on one un-repairable card. A gate has to be designed around that — an explicit allowlist carrying that cards reason, or a baseline diff that fails only on NEW instances. Blanket-gating all 261 findings is not an option either.

## Acceptance
- [x] a terminal card with 0 boxes produces an ERROR-level finding — ALREADY TRUE before this card was filed, `lib/trdd-doctor.ts:895-912`
- [x] the live corpus finding on 39OPYXQ9 is reported, not auto-fixed — VERIFIED: exactly one ERROR, `autofixable: false`
- [ ] a GATE exists that fails on a NEW terminal-without-checklist card, designed around 39OPYXQ9 AND G6A54OYK being frozen and un-repairable (allowlist naming BOTH ids with their reasons, or a baseline diff) — this is the only remaining work
- [ ] the gate does NOT blanket-fail on the 261 pre-existing corpus findings

## Approval log

- 2026-08-27T23:02:44+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T22:23:12+0200 — TRDD-55H0DOO6 triage: the live corpus carries TWO frozen
  TERMINAL-WITHOUT-CHECKLIST cards, not one — `G6A54OYK` (`completed`, archived 2026-08-22)
  beside `39OPYXQ9`. The gate box above now names both; an allowlist naming only 39OPYXQ9
  would leave `validate` red on a card nobody may repair. Neither gets a retro-authored
  checklist (that manufactures evidence).
