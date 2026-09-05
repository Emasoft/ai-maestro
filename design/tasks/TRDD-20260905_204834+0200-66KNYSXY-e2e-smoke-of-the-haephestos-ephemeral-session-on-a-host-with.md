---
trdd-id: 66KNYSXY
title: E2E smoke of the Haephestos ephemeral session on a host without Claude
column: todo
created: 2026-09-05T20:48:34+0200
updated: 2026-09-05T21:00:36+0200
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
This card exists to carry the parent's open box 4 — the client-availability E2E check (HELPERS section hides the Haephestos card on a host without Claude). The three launch/cleanup boxes below were the coordinator's paraphrase at mint time and stay as additional smoke criteria; the box added 2026-09-05 is the one the parent is blocked on.

## What the smoke must show

A fresh Haephestos helper session launches with the pinned args, ends, and leaves no `~/agents/haephestos` residue and no `_aim-creation-helper` tmux session.

## Acceptance

- [ ] A fresh helper session launch is observed to carry the pinned launch args (no `--continue`, `--agent haephestos-creation-helper`)
- [ ] After the session ends and cleanup runs, `~/agents/haephestos/` exists and is empty (no leftover artifacts/tentative plugins)
- [ ] No `_aim-creation-helper` tmux session remains after cleanup
- [ ] On a machine WITHOUT Claude installed, the dashboard's HELPERS section hides the Haephestos card entirely (client-availability gate; this is parent E5AAE555's box 4, quoted verbatim from its card)

## Approval log

- self-mandate (min-approval-requirement: none) by ai-maestro-hub-session; deferred acceptance criterion split from TRDD-E5AAE555.
- 2026-09-05T21:00:34+0200 — widened by ai-maestro-hub-session: the parent's box 4 (client-availability, HELPERS section hides the card without Claude) added as acceptance box 4; the mint prompt had paraphrased the criterion as a launch/cleanup smoke.

## Approval log

- 2026-09-05T20:48:34+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
