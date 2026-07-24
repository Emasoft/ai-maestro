---
trdd-id: YLCTM8EU
title: version-update routing a - server keeps the janitor plugin current
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:00:53+0200
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
**FINDING 2026-07-24 (grounded + verified):** ALREADY SATISFIED behaviorally. The
`aiMaestroMarketplace` category (default ON when the master toggle is on) enumerates candidates
DYNAMICALLY via `auto-update-service::listInstalledPluginsInMarketplace(MARKETPLACE_NAME)`
(= `listUserScopePlugins` + `listAgentLocalScopePlugins`, filtered by marketplace). The janitor IS
installed user-scope (verified in `~/.claude/settings.json`), so it is ALREADY a candidate — no
hardcoded role-plugin filter excludes it. The category comment falsely implied "8 role-plugins +
core mirror" only; FIXED (auto-update-settings.ts) to document the dynamic behavior + cite this TRDD.
The remaining lever is the master toggle (`enabled`, default OFF) — a deliberate human opt-in, same
class as the R16 rotation flag. NEXT ACTION: add a candidate-set unit test (needs mockable
`listUserScopePlugins` deps) to lock in janitor inclusion (acceptance box 2).

## Spec

- Add `ai-maestro-janitor@ai-maestro-plugins` to the server's auto-update candidate set
  (`lib/auto-update-settings.ts` / auto-update-service) so a running server installs new janitor
  releases (janitor confirmed (a) is the only real fix; (b) is a no-op while a server is live).

## Acceptance

- [x] With a newer janitor release available, a running server updates the cached plugin — VERIFIED: janitor installed user-scope is dynamically in the `aiMaestroMarketplace` candidate set (no filter excludes it); the auto-update master toggle is the human opt-in.
- [ ] Unit/integration test covers the candidate-set inclusion — REMAINING (needs mockable deps).

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
