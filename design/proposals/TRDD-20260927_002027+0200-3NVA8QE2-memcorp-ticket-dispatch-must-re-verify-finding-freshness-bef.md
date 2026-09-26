---
trdd-id: 3NVA8QE2
title: MEMCORP ticket dispatch must re-verify finding freshness before spawning an agent
column: proposal
status: proposed
created: 2026-09-27T00:20:27+0200
updated: 2026-09-27T00:20:27+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# MEMCORP ticket dispatch must re-verify finding freshness before spawning an agent

## Problem
Seven MEMCORP-001 tickets opened 2026-09-26/27 (T-8LL7777Q, T-7TODZ84M, T-8ZQTLXK3, T-AKSOXF23, T-BUD85JTO, T-C39MZ618, T-C82ZHALS); six closed self-healed or not-reproducible because the enrich/repair memory chores heal findings faster than the ticket queue drains. Each wasted ticket costs a ~400-500k-token subagent run. Only T-8ZQTLXK3 needed a real mutation.

## Root cause
The heartbeat opens tickets from a finding snapshot taken at detector time; the enrich/repair chore dispatched from the SAME heartbeat mutates the corpus before the ticket work agent reads it. The dispatcher never re-checks whether the finding still holds at dispatch time.

## Proposed fix (in Emasoft/ai-maestro-janitor — cross-repo, do not edit here)
At ticket dispatch, re-run the single finding's check (cheap, per-page lint of the named file) and auto-close the ticket as self-healed when it no longer reproduces. Alternatively, mark findings stale when a repair/enrich transaction commits in the same scope.

## Verification
Fixture: seed a finding, run the healing chore, fire the dispatcher — assert it closes the ticket without spawning a work agent; assert a still-present finding still dispatches.

## Estimated risk
LOW — dispatch-time check only, no detector changes. Depends on janitor plugin release cadence.

## Approval log
