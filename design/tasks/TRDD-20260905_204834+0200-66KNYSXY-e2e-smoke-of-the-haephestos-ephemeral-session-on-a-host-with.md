---
trdd-id: 66KNYSXY
title: E2E smoke of the Haephestos ephemeral session on a host without Claude
column: todo
created: 2026-09-05T20:48:34+0200
updated: 2026-09-05T20:48:45+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: spike
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T20:48:34+0200
parent-trdd: E5AAE555
derived: true
derived-kind: eht
---

# E2E smoke of the Haephestos ephemeral session on a host without Claude

## Problem

This card carries the parent's DEFERRED ACCEPTANCE CRITERION — the E2E smoke box — not an effect the parent's change opened.

## What the smoke must show

A fresh Haephestos helper session launches with the pinned args, ends, and leaves no `~/agents/haephestos` residue and no `_aim-creation-helper` tmux session.

## Acceptance

- [ ] A fresh helper session launch is observed to carry the pinned launch args (no `--continue`, `--agent haephestos-creation-helper`)
- [ ] After the session ends and cleanup runs, `~/agents/haephestos/` exists and is empty (no leftover artifacts/tentative plugins)
- [ ] No `_aim-creation-helper` tmux session remains after cleanup

## Approval log

- self-mandate (min-approval-requirement: none) by ai-maestro-hub-session; deferred acceptance criterion split from TRDD-E5AAE555.

## Approval log

- 2026-09-05T20:48:34+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
