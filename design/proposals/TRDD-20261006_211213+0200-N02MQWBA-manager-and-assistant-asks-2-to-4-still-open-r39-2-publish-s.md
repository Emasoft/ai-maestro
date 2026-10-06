---
trdd-id: N02MQWBA
title: MANAGER and ASSISTANT asks 2 to 4 still open, R39.2 publish status, R23 clause 2 skills layer, mention wording
column: proposal
status: proposed
created: 2026-10-06T21:12:13+0200
updated: 2026-10-06T21:12:13+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# MANAGER and ASSISTANT asks 2 to 4 still open, R39.2 publish status, R23 clause 2 skills layer, mention wording

## Problem
Issue 127 was filed by the ASSISTANT role-plugin with four asks. Ask 1 (which R39 binds) dissolved: main and governance-rules now serve a byte-identical GOVERNANCE-RULES.md v5.3.3. The hub (2026-08-08 ruling, tracked by 9SEQ4QI9) settled workdir-containment hook ownership, and 9SEQ4QI9 cites 127 only in a record-the-ruling box.
## Current open asks
Ask 2: R39.2 says the ASSISTANT role-plugin is a local source intentionally not published, yet the repo is public, released (v0.3.x) and listed in the marketplace; either amend R39.2 or de-publish (a USER-level decision with downstream consequences), and the role-plugin is deliberately not in PREDEFINED_ROLE_PLUGIN_NAMES (do not change that count). Ask 3: R23 clause 2 (role-plugins instruct the frozen CLI in their skills) has no target in a persona-only plugin that ships zero skills; decide where the decision-time surface lives. Ask 4: canonical mention wording. Related: G1.1 is documented inaccurate (its claim that canonical R22 text is reproduced verbatim in the persona is false since v0.3.4, blocked on a CPV issue); only the USER may edit a golden rule. A residual: CLAUDE.md on main does not index governance-spec. The hub's last comment: say which ask needs a hub answer and it goes to the front.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 127: MENTION-ONLY, partial, asks 2 to 4 open.
## Acceptance
- [ ] R39.2 amended or the publication decision recorded
- [ ] A decision on the R23 clause 2 surface for persona-only plugins
- [ ] Canonical mention wording published
- [ ] G1.1 clause routed to the USER
external-refs: Emasoft/ai-maestro issue #127 (https://github.com/Emasoft/ai-maestro/issues/127)

## Approval log
