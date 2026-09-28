---
trdd-id: AUC1GJ9B
title: CreateAgent allowExternalFolder under-agents refuses (g05c test B red on unmodified code)
column: todo
status: tasked
created: 2026-09-28T21:49:09+0200
updated: 2026-09-28T21:52:33+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-09-28T21:49:09+0200
---

# CreateAgent allowExternalFolder under-agents refuses (g05c test B red on unmodified code)

## Approval log

- 2026-09-28T21:49:09+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-28T21:49:15+0200 — column → todo by main-agent@ai-maestro.
- 2026-09-28T21:50+0200 — minted by the project main agent (ai-maestro hub session) under the USER's 'do it all' directive. Body: Test B of tests/integration/createagent-g05c-gitignore.test.ts asserts an AUTONOMOUS CreateAgent with workingDirectory=~/agents/adopted-plugin-repo and allowExternalFolder=true succeeds. It fails (success=false) on UNMODIFIED code: proven by stash A/B on governance-rules HEAD fde29683 and by a worktree run at f8d635c31~1 (pre 2026-09-26). The allowExternal path skips G03-ENFORCE entirely, so the refusal comes from another gate — suspects: the name-collision branch at element-management-service.ts:10414 (stat mocked ENOENT so it should pass), G03-OVERLAP (:10518), or a later gate returning before G05c. Debug by logging result.error in the test. Discovered while routing G03-ENFORCE through the workdir-policy authority (TRDD-WLWHVMKT); that change is unrelated and safe.
- 2026-09-28T21:49:23+0200 — column → todo by main-agent@ai-maestro.
- REVIEW CORRECTION 2026-09-28 — 'pre-existing' softened: the failure PRE-DATES this branch's uncommitted change (stash A/B) and was reproduced at f8d635c31~1 in a worktree, but dependency drift since that commit was NOT bisected (shared node_modules) — the airtight claim is 'older than the routing change', not 'pre-existing since before 09-26'.
