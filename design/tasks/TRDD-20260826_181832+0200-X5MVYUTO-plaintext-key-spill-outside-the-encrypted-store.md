---
trdd-id: X5MVYUTO
title: Encryption at rest does not stop the server writing decrypted keys to logs temp files or crash dumps
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:35+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
labels: [security, encryption-at-rest]
external-refs: [TRDD-NFHFN8AJ]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:35+0200
---

## Problem

Encryption at rest protects the store. It does not protect a plaintext copy the server
writes somewhere else — a temp file, a debug dump, a log line, a crash report, or a
`console.log` during an incident.

Observed on this host during the same session: an unrelated dev script writing to
`/tmp/settle5.txt`, i.e. writing intermediate state to a world-readable location is an
established habit in this codebase's tooling.

## Task

1. INVESTIGATE — grep the server for any path that can serialize a decrypted key or token:
   log calls, error objects carrying config, temp files, crash handlers, telemetry.
2. ASSESS — which of those are reachable in production and whether the plaintext survives.
3. SAFEGUARD — a redaction layer at the log boundary, no plaintext key in any error object,
   crash reports disabled or scrubbed, and temp files for decrypted material forbidden.

## Acceptance

- [ ] Every serialization path for decrypted material enumerated.
- [ ] A test that logs an object containing a token and asserts the token does not appear.
- [ ] Crash-dump behaviour recorded and, if it can carry keys, disabled or scrubbed.

## Approval log

- 2026-09-05T10:21:35+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  plaintext key spill outside encrypted store still unaddressed . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
