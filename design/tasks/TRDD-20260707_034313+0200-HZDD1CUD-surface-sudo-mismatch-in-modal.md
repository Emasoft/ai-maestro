---
trdd-id: HZDD1CUD
title: Surface sudo operation and subject mismatch errors in the sudo modal instead of failing silently
column: planned
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-016, batch-backlog-20260707]
task-type: bugfix
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_016_2026-06-23T13-18-05Z.md"]
---

# TRDD-HZDD1CUD — Surface sudo mismatch errors in the sudo modal

## Problem

While SCEN-016's BUG-001 was live, the UX was: enter password → modal closes → the change
silently reverts with NO visible explanation; the `sudo_operation_mismatch` /
`sudo_subject_mismatch` reasons lived only in the server devHint and console.error. The
user would re-enter the password forever. Verified 2026-07-07: `lib/sudo-fetch.ts` and
`contexts/SudoContext.tsx` contain no handling for these error codes — the silent dead-end
remains for any future op-binding edge case (expired token, subject change, a new
logical-tag slip).

## Root cause

`sudoFetch` returns the failed retry Response opaquely; callers only console.error it. The
modal closes on a successful MINT (200), so the subsequent op-bound retry failure has no
surface.

## Proposed fix

When `sudoFetch`'s retry returns a 403 whose body `error` is `sudo_operation_mismatch` or
`sudo_subject_mismatch`, signal the caller with a typed rejection (e.g. throw
`SudoRetryRejected` carrying the parsed body) and re-open the sudo modal (or a toast) with
the user-facing `message`. Files: `lib/sudo-fetch.ts`, `contexts/SudoContext.tsx`, callers
like `AgentProfilePanel.handleProgramChange`.

## Verification

Unit-test the `sudoFetch` rejection path (forced mismatch → typed error); manual: force a
mismatch and confirm the modal/toast shows the reason instead of a silent snap-back.

## Estimated risk

LOW — error-surface only; no change to token semantics.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
