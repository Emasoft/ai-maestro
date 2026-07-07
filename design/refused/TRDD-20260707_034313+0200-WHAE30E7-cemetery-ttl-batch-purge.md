---
trdd-id: WHAE30E7
title: Cemetery TTL and batch purge to end unbounded cross-run archive accumulation
column: refused
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: MEDIUM
effort: M
labels: [scenario-improvement, scen-012, scen-016, batch-backlog-20260707]
task-type: feature
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_012_20260623T114625Z.md", "reports_dev/scenarios-runner/scenario_proposed-improvements_016_2026-06-23T13-18-05Z.md"]
---

# TRDD-WHAE30E7 — Cemetery TTL + batch purge

## Problem

`~/.aimaestro/cemetery/` accumulated ~20 archives, ALL from scenario runs months old
(SCEN-012 and SCEN-016 runs both flagged it). They grow disk unbounded, clutter the
Cemetery UI, make cleanup verification ambiguous (a stale same-name archive produced a
TRUE match against a 2-month-old artifact in SCEN-012 S032), and mask genuine
soft-delete-leak signals. Verified 2026-07-07: `app/api/agents/cemetery/route.ts` has no
TTL/olderThan support.

## Root cause

No retention policy on cemetery archives; they are only ever removed by manual per-entry
UI Purge.

## Proposed fix

1. A configurable cemetery TTL (default e.g. 30 days) swept on server startup or by the
   janitor heartbeat.
2. `DELETE /api/agents/cemetery?olderThan=<days>` (strict route, registered in
   security-registry.json) + a "Purge all older than N days" button in the Cemetery
   settings tab.
3. Keep it opt-in/configurable — the cemetery is a recovery safety net (interacts with
   TRDD-UMT9HIEB, which will make soft-delete archives the DEFAULT).

## Verification

Create an archive with `archivedAt` older than the TTL → sweep → gone; a fresh archive
survives; the API purge respects the olderThan bound.

## Estimated risk

LOW-MED — deletion logic around a recovery mechanism; must default conservative.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Unbounded-growth concern not yet observed; scenario cleanups purge their own entries; revisit if growth materializes.
