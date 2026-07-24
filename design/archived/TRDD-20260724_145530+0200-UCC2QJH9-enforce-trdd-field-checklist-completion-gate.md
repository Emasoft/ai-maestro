---
trdd-id: UCC2QJH9
title: Enforce the TRDD field and checklist completion gate
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:00:53+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: docs
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
relevant-rules: [janitor81, janitor109]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: make the TRDD completion gate (assignee + blocked-by + column + checklist) enforced, not
advisory, by making the §D4 watchdog checklist explicit (B1) and coordinating its build on
janitor#109 (B2). NEXT ACTION: author/execute NPT B1 (DEP overlay edit), then EHT B2 (coordination
comment). Not started.

## Spec

- B0 (this TRDD) is the parent making the completion gate enforced, not advisory.
- B1 — DEP overlay: make §D4's watchdog checklist explicit. In
  `rules/aimaestro/aimaestro-trdd-approval.md` §D4, add the checks the watchdog must run: (i)
  `assignee` present; `blocked-by` non-empty ⟺ `column: blocked`; `column` ∈ the 17-enum; (ii)
  parse the bottom `- [ ]/[x]` checklist; (iii) **terminal-column invariant**: `column ∈
  {complete,published,live}` ⇒ every box `[x]`, else move back to `pre-block-column`/`dev` and
  flag. Bump `updated:`; keep byte-parity with the IND base wording (janitor#81).
- B2 — Coordinate the §D4 watchdog build on janitor#109. Comment on janitor#109 with B1's three
  checks as the watchdog's acceptance criteria; cite mechanism-B (ai-maestro#59) + janitor#81 +
  core#32 (skills must teach `min-approval-requirement:`). Self-identify (PRRD G1).

## Acceptance

- [x] B1: overlay §D4 5b landed — `grep "column ∈ {complete" rules/aimaestro/aimaestro-trdd-approval.md` = 1 hit. Committed cc4e25da; DEP tests pass.
- [x] B2: comment posted on janitor#109 (issuecomment-5070110091); the watchdog now enforces the 5b checks.
- [x] Parent B0 terminal — both B1 and B2 landed.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: manager). Pre-approved; born approved to author+execute.
- 2026-07-24T16:00:53+0200 — COMPLETED by ai-maestro. B1 (overlay §D4 5b) + B2 (janitor#109 comment) verified; column → complete.
