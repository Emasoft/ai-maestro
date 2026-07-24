---
trdd-id: YLCTM8EU
title: version-update routing a - server keeps the janitor plugin current
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
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: add `ai-maestro-janitor@ai-maestro-plugins` to the server's auto-update candidate set so a
running server installs new janitor releases (routing (a); (b) is a no-op while a server is live).
NEXT ACTION: edit `lib/auto-update-settings.ts` / auto-update-service to include the janitor
plugin in the candidate set. Not started.

## Spec

- Add `ai-maestro-janitor@ai-maestro-plugins` to the server's auto-update candidate set
  (`lib/auto-update-settings.ts` / auto-update-service) so a running server installs new janitor
  releases (janitor confirmed (a) is the only real fix; (b) is a no-op while a server is live).

## Acceptance

- [ ] With a newer janitor release available, a running server updates the cached plugin
- [ ] Unit/integration test covers the candidate-set inclusion

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
