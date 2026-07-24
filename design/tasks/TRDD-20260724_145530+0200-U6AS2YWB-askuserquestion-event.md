---
trdd-id: U6AS2YWB
title: AskUserQuestion event ESC-flood then cursor-ready then directive
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: eht
blocked-by: [TRDD-6HEF0XLS, TRDD-X8801GT4]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the AskUserQuestion event — flood ESC to dismiss the menu, poll until the cursor
is back at a typeable prompt, then inject the continuation directive as a curated command key.
Blocked on TRDD-6HEF0XLS and TRDD-X8801GT4 landing first. NEXT ACTION: wait for the reader +
registry, then implement the per-client menu signature + curated directive key. Not started.

## Spec

- Per-client menu signature (following `looksLikeAbandonPrompt`); inject ESC repeatedly, **poll
  until the cursor is back at a typeable prompt** (`getForegroundCommand`/`waitForShellReady`),
  bounded by a max-ESC ceiling.
- THEN inject the continuation directive, verbatim: *"decide the best course of action by
  yourself after carefully evaluate the facts. do not assume anything, verify all before
  deciding."* — registered as a NEW fixed curated command key in `lib/agent-commands.ts` (never
  raw free-text, preserving the injection-proof boundary).

## Acceptance

- [ ] A driven AskUserQuestion menu → ESC dismisses it → the directive lands
- [ ] No 300 s timeout
- [ ] The ESC count is bounded

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
