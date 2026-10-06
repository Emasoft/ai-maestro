---
trdd-id: 9KPN1FOJ
title: unblock-when carry-back into TRDD-2UPK4XZG — two semantics fixes
column: refused
status: proposed
created: 2026-10-06T21:05:29+0200
updated: 2026-10-06T21:23:12+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
derived: false
derived-kind: 
parent-trdd: 
relevant: [TRDD-2UPK4XZG]
---

# unblock-when carry-back into TRDD-2UPK4XZG — two semantics fixes

Source: Emasoft/ai-maestro issue #158.

unblock-when has been adopted into the IND TRDD base (janitor rules/trdd-design-tasks.md, evaluator scripts/detectors/trdd-drift.py::evaluate_unblock_when, commit f512540f, governing card TRDD-RTRS704K). Two fixes carried back from implementing it against a real 391-card board:

1. A terminal blocker is not necessarily a cleared blocker — the blocked-by hold must require a SHIPPED column (complete/completed/published/live), not any terminal column; failed/refused/cancelled/superseded are terminal but mean the dependency was never satisfied.

2. The blocker index must span every design folder (tasks/archived/proposals/refused) — an index over tasks/ alone makes a blocker that shipped and was archived invisible, leaving its dependent blocked forever.

Implementation detail worth copying: the log: predicate reads a bounded tail window (256 KiB, seek-from-end) and must drop everything up to the first newline BEFORE matching, else ^ can anchor on a cut line fragment; known ceiling: a window with no newline at all matches nothing.

Parent: TRDD-2UPK4XZG carries the original unblock-when design — this card links it as carry-back.

external-refs: Emasoft/ai-maestro issue #158 (https://github.com/Emasoft/ai-maestro/issues/158)

Supersedes TRDD-W029KGVC, which was minted with a self-issued mandate at the wrong approval floor (adversarial review of commit c7555c0bb).

## Approval log
- 2026-10-06T21:23:12+0200 — REFUSED by main-agent@ai-maestro (min-approval-requirement: manager). withdrawn by its author: both fixes moved onto TRDD-2UPK4XZG as acceptance boxes; a second card would be a second owner of the same work.

## Correction

The archived original's Approval-log line says the mandate was withdrawn and the card became a proposal. Neither happened: trddgrep refused the mandate rewrite and the move back to proposal. This card is the correction.
