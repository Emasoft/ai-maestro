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
Seven MEMCORP-001 tickets opened 2026-09-26/27 (T-8LL7777Q, T-7TODZ84M, T-8ZQTLXK3, T-AKSOXF23, T-BUD85JTO, T-C39MZ618, T-C82ZHALS); six closed self-healed or not-reproducible because the enrich/repair memory chores heal findings faster than the ticket queue drains. Each wasted ticket costs a ~400-500k-token subagent run. Two of seven did real work (T-8ZQTLXK3 widened a recall surface; T-C39MZ618 fixed 20 one-sided links across 18 pages via 19 verify_repair transactions); five runs mutated nothing.

## Root cause
The heartbeat opens tickets from a finding snapshot taken at detector time; the enrich/repair chore dispatched from the SAME heartbeat mutates the corpus before the ticket work agent reads it. The dispatcher never re-checks whether the finding still holds at dispatch time. CO-CANDIDATE (unverified, the implementer must discriminate): plugin version skew — the T-C39MZ618 agent measured 6 phrases against 'the installed memgrep's 4-phrase floor' while the detector's memgrep uses a 15-phrase floor (retired by the 2026-09-25 rebuild), so a floor mismatch between the detector's toolchain and the installed one makes findings self-heal trivially. The dispatch-time re-check is correct under BOTH mechanisms, but the implementer must verify which one actually fires — auto-closing findings whose real cause is a floor mismatch would close the signal that surfaces that bug.

## Proposed fix (in Emasoft/ai-maestro-janitor — cross-repo, do not edit here)
At ticket dispatch, re-run the single finding's check (cheap, per-page lint of the named file) and auto-close the ticket as self-healed when it no longer reproduces. Alternatively, mark findings stale when a repair/enrich transaction commits in the same scope. TRANSPORT: this card is filed here for screening only; implementation lands via a GitHub issue on Emasoft/ai-maestro-janitor referencing this TRDD (precedent: #309, #312) — a cross-repo fix card that never leaves this queue dies here.

## Verification
Fixture: seed a finding, run the healing chore, fire the dispatcher — assert it closes the ticket without spawning a work agent; assert a still-present finding still dispatches.

## Estimated risk
LOW — dispatch-time check only, no detector changes. Depends on janitor plugin release cadence.

## Approval log
