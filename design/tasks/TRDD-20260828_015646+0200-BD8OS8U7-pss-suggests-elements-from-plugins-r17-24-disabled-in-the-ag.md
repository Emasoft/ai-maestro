---
trdd-id: BD8OS8U7
title: PSS suggests elements from plugins R17.24 disabled in the agent because its enablement filter runs at index time
column: todo
created: 2026-08-28T01:56:46+0200
updated: 2026-08-28T23:08:11+0200
current-owner: hub-claude
created-by: hub-claude
task-type: docs
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T01:56:46+0200
---

# PSS suggests elements from plugins R17.24 disabled in the agent because its enablement filter runs at index time

## Problem
R17.24 disables non-whitelisted user-scope plugins by writing `key: false` into the AGENT's own `.claude/settings.local.json` at wake. perfect-skill-suggester's only enablement filter (`pss_discover.py:283-323`) reads `~/.claude/settings.json` at INDEX-BUILD time, so a plugin R17.24 switched off for one agent is still suggested to that agent.

Reported by perfect-skill-suggester-f1 during the 2026-08-27 fleet coordination pass.

## Scope
This card is the ai-maestro-side CONSUMER-CONTRACT note only. The code fix belongs to PSS (sibling of their TRDD-3JYVXDZG): read the agent's `.claude/settings.local.json` at SUGGEST time, honouring settings precedence (local beats user).

## Acceptance
- [x] the R17.24 row in docs/GOVERNANCE-RULES.md names the consumer contract — appended as **CONSUMER CONTRACT (TRDD-BD8OS8U7)** at the row's tail (2026-08-28); governance table tests green
- [ ] the PSS-side card id is cited here once it exists — CHECKED 2026-08-28: no card in the PSS repo's `design/tasks|proposals` and no issue mentions it (`gh api …/git/trees`, `gh issue list --search`). Next step is a GitHub issue on `Emasoft/perfect-skill-suggester` (cross-project rule, Method 1) — outward-facing, so it waits for the owner's go

## Approval log

- 2026-08-28T01:56:46+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T23:08:11+0200 — box 1 delivered by hub-claude (doc contract). Box 2 waits on a PSS-side id; filing the PSS issue needs the owner's go.
