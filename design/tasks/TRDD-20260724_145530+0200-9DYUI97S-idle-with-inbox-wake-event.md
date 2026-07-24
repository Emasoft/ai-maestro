---
trdd-id: 9DYUI97S
title: Idle-with-inbox wake event
column: blocked
pre-block-column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T15:07:44+0200
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
relevant-rules: [ai-maestro-51]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the idle-with-inbox wake event — an online+idle agent with a pending AMP inbox
gets a turn-trigger curated key injected. Blocked on TRDD-6HEF0XLS and TRDD-X8801GT4 landing
first. NEXT ACTION: wait for the reader + registry, then wire the idle+inbox detection. Not
started.

## Spec

- Detect online+idle (`readHookNotification` `idle_prompt`) + a pending AMP inbox → inject a
  turn-trigger curated key so the agent drains its inbox.
- Ties to ai-maestro#51 / 4ALV5ISB worker side.
- Gated on the same cooldown/STOP/HID.

## Acceptance

- [ ] An idle agent with a queued AMP message takes a turn and processes it

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
