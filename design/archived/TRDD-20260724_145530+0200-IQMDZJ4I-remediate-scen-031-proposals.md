---
trdd-id: IQMDZJ4I
title: Remediate the 9 SCEN-031 proposals per the USER rulings
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:00:53+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: remediate the 9 SCEN-031 proposals per the USER's rulings, via two remediation tasks
(A1 = rewrite 1K2TZVIP; A2 = re-anchor the 3 automaton proposals) — tracked as checklist items
below, NOT child TRDDs (both already landed this session; see the checklist).
NEXT ACTION: author/execute NPT A1 (rewrite 1K2TZVIP) and A2 (re-anchor the 3 automaton
proposals), then close this parent. Not started.

## Spec

- A0 (this TRDD) is the parent gating remediation of the 9 SCEN-031 proposals.
- A1 — Rewrite proposal 1K2TZVIP to the field+checklist enforcement ruling. In
  `design/proposals/…1K2TZVIP….md` rewrite `## Problem`+`## Proposed fix` — the fleet's
  `assignee`+`blocked-by` split is **not** a substitute for `column`; every TRDD carries
  `assignee` + `blocked-by`(if blocked) + `column`, kept current at every change, + the bottom
  checklist; **completion ⇔ every box `[x]` AND `column ∈ {complete,published,live}`**. Point the
  fix at Flock B (the §D4 watchdog). Keep the id/history; bump `updated:`.
- A2 — Re-anchor the 3 automaton proposals to the canonical mechanisms. `4ALV5ISB` → cite
  ai-maestro#51 + Flock E; `1B7FC42W` → cite Flock E's AskUserQuestion event; `F1S7QQX6` → cite
  #89 (server half) + Flock E (UI half); add that the retry-wedge is #90. Replace vague "pick per
  design review" text with the ratified references.

## Acceptance

- [x] A1: 1K2TZVIP states the enforce ruling (14 signal lines); `grep -i "loosen\|accept EITHER"` = 0 hits. Committed 1f3f45be.
- [x] A2: each of the 3 automaton proposals (4ALV5ISB, 1B7FC42W, F1S7QQX6) carries a "Canonical mechanism" block. Committed 1f3f45be.
- [x] Parent A0 terminal — both A1 and A2 landed.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T16:00:53+0200 — COMPLETED by ai-maestro. A1+A2 verified (grep-checks pass); column → complete.
