---
trdd-id: SOPULLUB
title: A failed read of the agent registry must not be followed by a write that replaces it
column: todo
status: tasked
created: 2026-10-05T07:14:55+0200
updated: 2026-10-07T05:28:57+0200
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
approval-datetime: 2026-10-05T07:14:55+0200
---

# A failed read of the agent registry must not be followed by a write that replaces it

## Problem

Found 2026-10-05 by the caller enumeration on TRDD-8E6XMDEX (worker read; report reports/8e6xmdex/20261005_071400+0200-loadagents-callers-on-corrupt-registry.md). loadAgents in lib/agent-registry.ts returns an empty list when the registry file exists but cannot be read or parsed. createAgent and the transfer import in services/agents-transfer-service.ts then push one row and call saveAgents, which writes unconditionally. One bad read (corrupt JSON, or a transient EBUSY or EACCES) therefore replaces the whole registry with a one-agent file. The G08 undo of the delete pipeline can write an empty snapshot the same way (inferred, not read end to end).

## Requirement

A writer that built its new content from a read which FAILED must refuse to write, and say which file could not be read. A missing file on a first-run host is not a failed read and must keep working.

## Acceptance

- [x] The claims above re-read by the implementer at the cited sites before any change
- [x] createAgent refuses when the registry exists but is unreadable; nothing is written; the error names the file
- [x] the transfer import refuses the same way
- [x] the G08 undo path read end to end; fixed or shown safe
- [x] a first-run host (no registry file) still creates its first agent
- [x] each refusal has a test on a temp state root that fails with the guard removed; no test writes the real registry

## Approval log

- 2026-10-05 — self-mandate by main-agent (min-approval-requirement none): a data-loss guard inside this project, reversible, no governance change.

## Approval log

- 2026-10-05T07:14:55+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
