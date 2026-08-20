---
trdd-id: MNN0VAS6
title: per-target plugin-update trail exposed as a spec'd read verb for the janitor
column: todo
created: 2026-08-20T08:27:07+0200
updated: 2026-08-20T08:27:07+0200
current-owner: ai-maestro-hub
task-type: feature
scope: project
project-id: ai-maestro
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-20T08:27:07+0200
---

# Per-target plugin-update trail — spec'd read verb

## Problem

Janitor ask (2026-08-20, follows the 4OFMHOZ7 offer): it attributes interrupted plugin
extractions from a LAST-RUN-ONLY summary, which cannot see earlier fires. It needs
start/end epoch + exit code PER `claude plugin update <target>` invocation.

## Proposed fix (specs-first)

1. Verify what the fleet-plugins-update lane already records per target (the trail rows
   from the KCRMSNL7 window) — formalize, do not duplicate.
2. Spec a read verb (likely on aimaestro-agent.sh or a small aimaestro-plugins.sh) returning
   the last N trail rows as JSON: {target, start_epoch, end_epoch, exit_code, by}.
3. Implement thin over the existing trail store; regen specs.

## Acceptance

- [ ] existing trail store measured first (rows per target? capped how?) — no duplicate store
- [ ] spec section written before implementation; specs:check red then green
- [ ] janitor notified with the exact invocation; their 4OFMHOZ7 consumer unblocked

## Approval log

- 2026-08-20T08:27:07+0200 — MANDATE issued by the hub (min-approval-requirement: none). No request sent.
