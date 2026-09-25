---
trdd-id: 4NISAY49
status: tasked
title: trddgrep archive verb - archive a card from any column, definitively
column: design
created: 2026-09-24T15:46:06+0200
updated: 2026-09-25T17:52:10+0200
current-owner: ai-maestro-main-session
created-by: ai-maestro-main-session
task-type: feature
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-main-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-main-session
approval-datetime: 2026-09-24T15:46:06+0200
implementation-commits: [4bc408427]
---

# trddgrep archive verb - archive a card from any column, definitively

## Approval log

- 2026-09-24T15:46:06+0200 — MANDATE issued by ai-maestro-main-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent. (identity redacted 2026-09-24: OS login replaced)
- 2026-09-24T15:55:39+0200 — column → design by user. owner-mandated 2026-09-24; the design is the pending proposal

## Source

Owner ruling 2026-09-24, quoted verbatim in TRDD-MQE5D28T under "USER rulings — 2026-09-24" (second quote): trddgrep archive <TRDD-ID> or <TRDD FILE PATH> archives a card whatever its column, and the archive is definitive.

## Acceptance

- [x] Implemented per the reviewed proposal (pending: the verb, the zone arbiter's rule for archived/, tests, and the verb lists in docs/rules/skills; which columns may be archived is decided in that proposal)

## Implementation

2026-09-25T06:05:41+0200 — code landed ahead of this card in 4bc408427 (Part B of TRDD-MQE5D28T step 4.6); the column was not advanced. Open gaps: same-zone duplicate-id filenames, mixed-case --as, no route-level archive tests.
2026-09-25T17:45:00+0200 — the three review gaps (reports/pillar-cli-fixes/20260925_001748+0200-archive-verb.md items 2-4) are CLOSED: same-zone v1/v2 duplicate-id and mixed-case `--as Completed` are fixture-tested in tests/unit/trddgrep-archive-verb.test.ts (4a3d94aef, each neuter-proven), and route-level POST /api/trdd/[id]/archive coverage landed in tests/api/trdd-archive-route.test.ts (2a58dcd03, 5 tests over a real tmp corpus; neuters: state-gate pair and checklist gate each redden their own test). Commit-message claims in 4bc408427 scoped accordingly: the duplicate-id claim covers cross-zone AND same-zone v1/v2 shapes now.
