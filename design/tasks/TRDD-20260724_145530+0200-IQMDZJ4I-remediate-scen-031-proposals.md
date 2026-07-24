---
trdd-id: IQMDZJ4I
title: Remediate the 9 SCEN-031 proposals per the USER rulings
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
npt: [A1, A2]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: remediate the 9 SCEN-031 proposals per the USER's rulings, via the two NPT children A1/A2.
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

- [ ] A1: the proposal states the enforce ruling; `grep -i "loosen\|accept EITHER" <file>` is empty
- [ ] A2: each of the 3 proposals (4ALV5ISB, 1B7FC42W, F1S7QQX6) cites its canonical issue/TRDD
- [ ] Parent A0 closed once A1 and A2 are terminal

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
