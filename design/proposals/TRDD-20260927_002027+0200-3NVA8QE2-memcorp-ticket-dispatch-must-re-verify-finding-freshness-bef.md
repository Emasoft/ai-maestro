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
MEMCORP-001 tickets opened 2026-09-26/27 — census frozen 2026-09-27 00:20, covering the EIGHT then-listed (T-8LL7777Q, T-7TODZ84M, T-8ZQTLXK3, T-AKSOXF23, T-BUD85JTO, T-C39MZ618, T-C82ZHALS, T-FS1L0VQF; T-FOPSWJGW opened after the freeze and is out of scope); seven closed self-healed or not-reproducible — their NAMED findings no longer reproduced by the time the work agent read them (the five no-mutation tickets plus T-C39MZ618 and T-C82ZHALS, whose named findings also healed). Accounting: FIVE closed with no mutation (T-8LL7777Q, T-7TODZ84M, T-AKSOXF23, T-BUD85JTO, T-FS1L0VQF); THREE closed resolved with real mutations (T-8ZQTLXK3 widened a recall surface; T-C39MZ618 fixed 20 one-sided links across 18 pages via 19 verify_repair transactions; T-C82ZHALS widened a description 5→20 phrases) — two of the three sit inside the seven whose named finding healed: sibling defects found while on site. Price the pipeline honestly: a discovery mechanism with a ~62.5% (5/8, frozen census) no-yield rate whose hits exceed the ticket's own scope, NOT pure waste; a no-yield run still costs ~400-510k tokens observed.

## Root cause
The heartbeat opens tickets from a finding snapshot taken at detector time; the enrich/repair chore dispatched from the SAME heartbeat mutates the corpus before the ticket work agent reads it. The dispatcher never re-checks whether the finding still holds at dispatch time. CO-CANDIDATES (unverified, the implementer must discriminate — do not ship for one mechanism without ruling out the others): (c) plugin version skew — the mechanism the timeline fits best: the 2026-09-25 rebuild recalibrated the phrase floor 15→4 BEFORE any of these tickets opened (Sep 26/27), so the detector that opened them cannot have been running the old floor unless it is a different copy of memgrep — which IS (c); (a) detector-vs-rebuild floor drift presupposes (c) — it describes how a skew arose historically (findings opened against a pre-recalibration floor self-retire when the rebuild lands) and applies only to tickets older than the rebuild; (b) same-heartbeat race — the chore dispatched from the fire that opened the ticket mutates the corpus first. The dispatch-time re-check is correct under ALL three, but auto-closing a finding whose real cause is floor drift would close the signal that surfaces the drift — the implementer must verify which mechanism actually fires before wiring the auto-close.

## Proposed fix (in Emasoft/ai-maestro-janitor — cross-repo, do not edit here)
At ticket dispatch, re-run the single finding's check (cheap, per-page lint of the named file) and auto-close the ticket as self-healed when it no longer reproduces. Alternatively, mark findings stale when a repair/enrich transaction commits in the same scope. TRANSPORT: this card is filed here for screening only; implementation lands via a GitHub issue on Emasoft/ai-maestro-janitor referencing this TRDD (precedent: #309, #312) — a cross-repo fix card that never leaves this queue dies here. DESIGN TRADE (round-2 review, must be resolved before implementation): a blanket dispatch-time auto-close would have closed T-C39MZ618 before it ran, and that run delivered the round's biggest win (20 one-sided LINK-LAW fixes found as siblings). The fix trades wasted runs for lost sibling-discovery — scope the auto-close to findings whose class has never produced sibling work, or accept the trade explicitly on the janitor issue.

## Verification
Fixture: seed a finding, run the healing chore, fire the dispatcher — assert it closes the ticket without spawning a work agent; assert a still-present finding still dispatches.

## Estimated risk
LOW — dispatch-time check only, no detector changes. Depends on janitor plugin release cadence.

## Approval log
