---
trdd-id: 2JC2ORBN
title: TERMINAL-WITH-OPEN-BOX has no grandfather boundary so pre-gate archived cards are permanently red
column: refused
created: 2026-08-27T15:22:51+0200
updated: 2026-08-27T15:32:08+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: rejected
approval-judge: hub-claude
approval-datetime: 2026-08-27T15:22:51+0200
priority: 2
severity: medium
effort: small
release-via: none
labels: [governance, trdd-doctor, tooling]
npt: []
eht: []
implementation-commits: []
---

# TERMINAL-WITH-OPEN-BOX has no grandfather boundary so pre-gate archived cards are permanently red

## Problem

The doctor's `TERMINAL-WITHOUT-CHECKLIST` rule carries a grandfather boundary: a card that went
terminal before the checklist gate existed is not flagged. `TERMINAL-WITH-OPEN-BOX` carries none.
So an archived, terminal, **frozen** (IND §12) card that slipped past the archive route before
`da7ec5e8` enforced the gate is red forever, with no legal repair: ticking the box manufactures
evidence, and re-columning is itself a §12 body edit.

Measured 2026-08-27: DXJZM3BW (closed 08-05, 1 of 8 open), IBKR7F74 (closed 08-25, 1 of 3 open),
39OPYXQ9 (closed 08-22, no checklist). The trdd-doctor gate test excludes them PER CARD in a named
set with this card as the justification — that keeps the gate live for a fourth, but it is the
wrong place for the fix.

## Proposed fix

Give `TERMINAL-WITH-OPEN-BOX` the same boundary shape `TERMINAL-WITHOUT-CHECKLIST` already has,
keyed on the date the archive route began enforcing the gate (`da7ec5e8`), so the two rules agree
about what "before the gate" means. Then retire the third exclusion set in
`tests/unit/trdd-doctor.test.ts`.

## Acceptance

- [ ] `TERMINAL-WITH-OPEN-BOX` grandfathers cards terminal before the enforcing commit's date
- [ ] The boundary date is ONE constant shared by both rules, not two literals
- [ ] `FROZEN_TRUE_FINDINGS_AWAITING_DOCTOR_BOUNDARY` removed from the gate test and the gate green
- [ ] A seeded pre-boundary AND a seeded post-boundary card in the doctor's own tests, so the boundary discriminates

## Approval log

- 2026-08-27T15:22:51+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0 self-mandate.
- 2026-08-27T15:32:08+0200 — REFUSED by hub-claude (the author; min-approval-requirement: none). PREMISE FALSE,
  measured against `lib/trdd-doctor.ts`: the boundary check `if (!day || day >= CHECKLIST_GATE_SINCE)`
  encloses BOTH branches — `boxes.total === 0` → TERMINAL-WITHOUT-CHECKLIST, else →
  TERMINAL-WITH-OPEN-BOX. The open-box rule already carries the grandfather boundary. The three
  cards this was filed for are dated 2026-08-05/-22/-25, all past the 2026-07-31 boundary, and
  are legitimately flagged. The boundary is normative (§D4 step 5b fixes the date in its own text)
  and is not this card's to move to the archive-route date. The gate test's per-card exclusion
  stands on a corrected justification: post-boundary TRUE findings on frozen cards (IND §12),
  unrepairable, excluded so the gate stays live for a fourth. Filed on an inference from a
  sibling rule's DOCSTRING (which mentions only WITHOUT-CHECKLIST) without reading the branch —
  the same proxy error this session recorded twice already.
