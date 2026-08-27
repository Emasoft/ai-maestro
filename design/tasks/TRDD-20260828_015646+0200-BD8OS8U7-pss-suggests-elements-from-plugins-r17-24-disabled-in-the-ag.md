---
trdd-id: BD8OS8U7
title: PSS suggests elements from plugins R17.24 disabled in the agent because its enablement filter runs at index time
column: todo
created: 2026-08-28T01:56:46+0200
updated: 2026-08-28T01:56:46+0200
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
- [ ] the R17.24 row in docs/GOVERNANCE-RULES.md names the consumer contract: any tool enumerating enabled plugins FOR AN AGENT must read the agent-local settings at USE time, never only the user-scope file at build time
- [ ] the PSS-side card id is cited here once it exists

## Approval log

- 2026-08-28T01:56:46+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
