---
trdd-id: W029KGVC
title: unblock-when carry-back into TRDD-2UPK4XZG — two semantics fixes
column: superseded
status: archived
created: 2026-10-06T17:07:50+0200
updated: 2026-10-06T21:07:19+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: manager
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: false
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-06T17:07:50+0200
derived: true
derived-kind: eht
parent-trdd: TRDD-2UPK4XZG
superseded-by: [TRDD-9KPN1FOJ]
---

# unblock-when carry-back into TRDD-2UPK4XZG — two semantics fixes

Source: Emasoft/ai-maestro issue #158.

unblock-when has been adopted into the IND TRDD base (janitor rules/trdd-design-tasks.md, evaluator scripts/detectors/trdd-drift.py::evaluate_unblock_when, commit f512540f, governing card TRDD-RTRS704K). Two fixes carried back from implementing it against a real 391-card board:

1. A terminal blocker is not necessarily a cleared blocker — the blocked-by hold must require a SHIPPED column (complete/completed/published/live), not any terminal column; failed/refused/cancelled/superseded are terminal but mean the dependency was never satisfied.

2. The blocker index must span every design folder (tasks/archived/proposals/refused) — an index over tasks/ alone makes a blocker that shipped and was archived invisible, leaving its dependent blocked forever.

Implementation detail worth copying: the log: predicate reads a bounded tail window (256 KiB, seek-from-end) and must drop everything up to the first newline BEFORE matching, else ^ can anchor on a cut line fragment; known ceiling: a window with no newline at all matches nothing.

Parent: TRDD-2UPK4XZG carries the original unblock-when design — this card links it as carry-back.

external-refs: Emasoft/ai-maestro issue #158 (https://github.com/Emasoft/ai-maestro/issues/158)

## Approval log

- 2026-10-06T17:07:50+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-06 — CORRECTION by main-agent@ai-maestro: the mint wrote a self-issued mandate at min-approval-requirement none; the objective floor for this card is manager (adversarial review of c7555c0bb). Mandate withdrawn; the card is a proposal awaiting the owner's approval. The USER directive was to open a TRDD per issue, which authorizes filing, not execution.
- 2026-10-06T21:07:19+0200 — SUPERSEDED by main-agent@ai-maestro. minted with a self-issued mandate at the wrong approval floor; replaced by a correctly-floored proposal.
