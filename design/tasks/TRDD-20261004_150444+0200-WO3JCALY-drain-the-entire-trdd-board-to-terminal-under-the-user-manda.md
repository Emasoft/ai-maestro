---
trdd-id: WO3JCALY
title: Drain the entire TRDD board to terminal under the user mandate
column: planned
status: tasked
created: 2026-10-04T15:04:44+0200
updated: 2026-10-04T15:20:27+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: none
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-04T15:04:44+0200
project-id: ai-maestro
scope: project
---

# Drain the entire TRDD board to terminal under the user mandate

## Approval log

- 2026-10-04T15:04:44+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-04T15:08:01+0200 — column → planned by main-agent@ai-maestro.
- 2026-10-04T15:20+0200 — MANDATE + VERIFICATION RECORD (USER 2026-10-04: 'complete all TRDDs, do not wait for my approval, verified facts and objective tests, security first, commit often, fan out lean workers'). TRDD-GY0LJV6S live-verification digest (card frozen; full report docs_dev/TRDD-GY0LJV6S-LIVEVERIFY.md): worker probe 4/4 PASS — server up (pm2 online, 401s on gated routes, ingest log advancing); routes found (GET /api/statusline enforceAuth; POST /api/statusline/ingest localhost-only + middleware whitelist; GET /[sessionId]); hook delivers (13 snapshots 2026-10-04, freshest 14:53, rateLimits 5h=19/7d=41, [statusline-ingest] log lines for same session ids); rotator fed (3 slots captured today, usage_samples 5h 17->19 / 7d 41 matching statusline, rotator.log 60s ticks). NUANCE: R16 opt-in flag absent per ORH handover — server-side TS tick deliberately inert, janitor daemon active driver; pipeline verified, actuation off by design. PROCESS RULES: one commit per transition, TRDD-<id8> in subject; no checklist = no close (author boxes + verify first); failed stays open/retryable; WO3JCALY is a tracking card, never per-card evidence. LOCK PROCEDURE: stale .git/index.lock — wait 3s, ps snapshot, if no git proc AND 0 bytes AND mtime < cmd start -> rm, retry once.
