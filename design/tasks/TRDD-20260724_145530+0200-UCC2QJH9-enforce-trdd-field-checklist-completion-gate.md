---
trdd-id: UCC2QJH9
title: Enforce the TRDD field and checklist completion gate
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T15:07:44+0200
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

- [ ] B1: `grep "column ∈ {complete" rules/aimaestro/aimaestro-trdd-approval.md` matches; the DEP
      size budget/tests still pass
- [ ] B2: comment posted on janitor#109; links resolve
- [ ] Parent B0 closed once B1 and B2 are terminal

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: manager). Pre-approved; born approved to author+execute.
