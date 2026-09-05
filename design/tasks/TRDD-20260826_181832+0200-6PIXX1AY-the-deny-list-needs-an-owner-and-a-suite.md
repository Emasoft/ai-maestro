---
trdd-id: 6PIXX1AY
title: A permissive sandbox profile is a living deny-list and needs a stated boundary plus a test suite
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:12+0200
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
labels: [security, sandbox, testing]
external-refs: [TRDD-EVO7T245, TRDD-Q79M7JV7, TRDD-V93RLKEB]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:12+0200
---

## Problem

A container denies by construction; a seatbelt profile written as `(allow default)` plus
targeted denies permits by construction and denies only what someone enumerated. The
enumeration is therefore a living artifact, not a one-time review — and nothing currently
owns it or tests it.

## Evidence that the enumeration moves

During a single session on 2026-08-26 the deny-list grew by six entries — cross-agent tty
read/write, signals, the AID key store, transcripts, LaunchAgent plists, shell rc files —
four of which were found only because the owner asked for another pass. That is not a
criticism of the approach; it is its measured maintenance cost, and it argues for an owner
and a suite rather than for abandoning it.

## Task

1. INVESTIGATE — decide the boundary the deny-list is meant to enforce, stated positively
   ("an agent may reach exactly: its own workdir, its own keys, its own transcripts, the
   network, the toolchain") so that new denies are derivable rather than discovered.
2. ASSESS — write the channel inventory as a checked artifact: what B reads, and what signs
   as B, per the narrowing established in the design discussion.
3. SAFEGUARD — a test suite that, for each inventory entry, drives the channel from a
   sandboxed process and asserts refusal, each with a non-vacuity control proving the probe
   can succeed when the rule is removed.

## Acceptance

- [ ] The boundary is stated positively and committed.
- [ ] A channel inventory exists as a file, not as prose in a card.
- [ ] Each entry has a test with a paired non-vacuity control.
- [ ] Adding a new agent-reachable surface without an inventory entry reddens the suite.
- [ ] The suite runs on macOS CI, or its absence is recorded with the reason.

## Approval log

- 2026-09-05T10:21:12+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  deny-list enumeration still ungoverned; profile comment names this card as owner, not yet closed . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
