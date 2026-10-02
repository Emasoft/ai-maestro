---
trdd-id: 4UCBYEZ4
title: Live-verify TRDD-2PFVKO7P after the ai-maestro server restarts
column: todo
status: tasked
created: 2026-10-03T01:07:04+0200
updated: 2026-10-03T01:07:45+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-03T01:07:04+0200
parent-trdd: 2PFVKO7P
derived: true
derived-kind: eht
npt: []
eht: []
---

# Live-verify TRDD-2PFVKO7P after the ai-maestro server restarts

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-10-03
NEXT ACTION: blocked on the user starting the server (pm2 start ecosystem.config.js). Then confirm through the running dashboard that a claude-fable-5-1 session reports a 1,000,000 context limit (computed at services/sessions-browser/local-context-breakdown.ts:1167), that an Opus 4.x/5 session's cost uses $5/$25 per MTok, and spawn screenshot-interpreter by bare name once to check it no longer sees CLAUDE.md (omitClaudeMd).

## Acceptance
- [ ] A claude-fable-5-1 session reports a 1,000,000 context limit in the running dashboard.
- [ ] An Opus 4.x/5 session's cost uses $5/$25 per MTok.
- [ ] screenshot-interpreter, spawned by bare name, does not see CLAUDE.md (omitClaudeMd).

## Approval log

- 2026-10-03T01:07:04+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
