---
trdd-id: G6EBLBIQ
title: TRDD corpus selection is caller-supplied rather than caller-derived
column: dev
created: 2026-09-13T02:34:07+0200
updated: 2026-09-13T15:46:51+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: security
min-approval-requirement: user
scope: project
project-id: ai-maestro
approved: true
approval-judge: user
approval-datetime: 2026-09-13T15:44:25+0200
implementation-commits: [25e5fc97e, 91b06b30b]
---

# TRDD corpus selection is caller-supplied rather than caller-derived

Nine routes under app/api/trdd/ choose which corpus to read from an agentId taken out of the query string or request body, via resolveDesignDir in lib/trdd-design-dir.ts:13-21. Authentication decides what verb the caller may run on a card; a separate, unvalidated request parameter decides which corpus that card comes from. Callers: app/api/trdd/route.ts:27, create/route.ts:26, kanban/route.ts:27, [id]/route.ts:14 and :42, [id]/approve/route.ts:50, archive/route.ts:18, promote/route.ts:17, refuse/route.ts:21, verify/route.ts:24. Fix shape: lib/trdd-authz.ts:110-133 authorizeTrddVerb(auth, designDir, id, verb) already receives both and uses designDir only to locate the card. Make designDir an authorized input there, derived from auth, and stop the routes passing a request parameter. A system-owner legitimately reads other agents corpora from the dashboard; the existing system-owner versus AID-bearer split (see the sudo guard module in lib) shows the pattern to reuse. This is the precondition for any group access control.

## Approval log
- 2026-09-13T15:44:25+0200 — APPROVED by user (min-approval-requirement: user). USER approved 2026-09-13: treat as approved.
- 2026-09-13 — APPROVED by USER, verbatim: "Yes — treat it as approved". NOTE THE SEQUENCE: implementation landed in 25e5fc97 and 91b06b30 BEFORE this card left design/proposals/, so for the life of both commits the card read `column: proposal` (not authorized to execute). Recorded here rather than concealed by the promotion.
