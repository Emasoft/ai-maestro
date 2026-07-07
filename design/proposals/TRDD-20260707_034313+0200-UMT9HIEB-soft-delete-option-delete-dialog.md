---
trdd-id: UMT9HIEB
title: Offer a soft-delete (archive to cemetery) option in DeleteAgentDialog
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-015, batch-backlog-20260707]
task-type: feature
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_015_2026-06-23T12-19-36Z.md"]
---

# TRDD-UMT9HIEB — Soft-delete option in DeleteAgentDialog

## Problem

The UI delete flow always sends `hard=true` (verified 2026-07-07:
`components/DeleteAgentDialog.tsx:50-62` hardcodes it, with comments documenting the
choice). Server gate G03 archives to the cemetery only when `!hard`, so a UI-deleted agent
leaves NO cemetery entry and has NO recovery window — a fat-fingered delete is
unrecoverable. It also makes every scenario's "purge cemetery" cleanup step vacuous
(SCEN-009/10/11/12/13/15).

## Root cause

The dialog hardcodes `hard: true`; there is no UI affordance to choose archival. (Note:
the current hardcoding is commented as deliberate — this proposal is a product-design
change, not a plain bug fix.)

## Proposed fix

Add a checkbox to `components/DeleteAgentDialog.tsx`: "Archive to cemetery (recoverable)"
DEFAULTING to checked (= soft delete, `hard=false`), with "Permanently delete (no
recovery)" as the explicit hard path. Wire the request's `hard` flag from the checkbox.
Server G03 already branches on `hard` — no server change beyond exercising the tombstone
path.

## Verification

Delete a test agent with the default → `GET /api/agents/cemetery` shows the archive and
the agent is revivable; delete with "permanent" checked → no cemetery entry (current
behavior preserved).

## Estimated risk

LOW-MED — changes the DEFAULT semantics of the most destructive UI action; cemetery growth
becomes the norm, so pair with TRDD-WHAE30E7 (cemetery TTL/purge).

## Approval log
