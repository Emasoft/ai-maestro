---
trdd-id: 4VCXRHAY
title: The index validates the whole corpus on every open and that is the scaling wall
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-29T00:36:05+0200
updated: 2026-07-29T00:36:05+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T00:36:05+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 0
severity: major
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The index validates the whole corpus on every open and that is the scaling wall

## The finding

Task #79 wired `greptrdd`'s graph subcommands to the pillar index. Measured immediately
afterwards, **the index never beats the walk at any size tested** — which makes the feature a
regression rather than an accelerator:

| corpus | walk | index (warm) | index (cold build) |
|---|---|---|---|
| 298 (live) | 0.24 s | **0.27 s** | — |
| 10 000 | 1.05 s | **1.03 s** | **117.6 s** |

The query is not the problem. Broken down at 10 000 cards:

| step | cost |
|---|---|
| `listDocuments` (all four zones) | 16 ms |
| `identifyFiles` (the freshness probe) | 50 ms |
| **`openIndex`** | **666 ms** |
| `syncIndex` (no-op delta) | 69 ms |
| **`cardsFromIndex` — THE ACTUAL QUERY** | **11 ms** |

**11 ms to answer over 10 000 cards, against ~850 ms of walking.** A 77× win, entirely eaten by
the open. And inside the open:

| check | cost |
|---|---|
| `new Database` + pragmas | 3.6 ms |
| `pragma user_version` | 0.0 ms |
| **`pragma integrity_check`** | **367.0 ms** |
| `pragma table_info` ×3 (shape) | 0.2 ms |
| **FTS parity `('integrity-check', 1)`** | **304.5 ms** |
| orphan scans (records + edges) | 2.8 ms |

## The diagnosis

`validate()` runs on EVERY `openIndex()`, and two of its seven checks are **full scans of the
whole index**: SQLite's `integrity_check` walks every b-tree page, and the FTS parity form walks
the entire inverted index against its content. Both are O(corpus). Both run before a query that
costs 11 ms.

So the cost is not incidental — **the safety mechanism IS the scaling wall.** At 10⁵ these two
checks project to ~7 s on every single `greptrdd board`. The USER asked for *stronger* safety
mechanisms on the indexer db and for the design to hold at 10⁵; as built, those two requirements
are in direct conflict, and nobody noticed because the contract was copied from memgrep — where
the corpus is a few hundred small notes and a full verify per open is free.

The 117.6 s COLD BUILD is the same shape one level up: `syncIndex` FTS-indexes ~98 MB of prose,
and `migrate`'s per-step `validateAt` re-runs the same two full scans inside the transaction.

## The decision

**Split validate into CHEAP and EXPENSIVE, and schedule them differently. Do not delete either.**

- **CHEAP — every open** (measured 3 ms at 10 000 cards, and metadata-only so it stays flat):
  the downgrade guard, `PRAGMA table_info` shape, the version stamp, and the orphan scans. These
  catch every *structural* fault — a missing column, a lying migration, a DB from a newer binary,
  rows pointing at an unindexed file.
- **EXPENSIVE — at every state TRANSITION and on demand, never on a read**: `integrity_check` and
  FTS parity run when the index is CREATED, inside every MIGRATION step (already the case —
  `migrate` calls `validateAt` in-transaction), after any HEAL, and on an explicit verify entry
  point a scheduled caller can invoke.

**Why this does not weaken the contract.** The checks still exist, still run, and still feed the
heal ledger; what changes is that a READ no longer pays for them. Every state transition — the
only moments that can actually introduce the corruption these two checks detect — is still fully
verified. A read cannot corrupt what it does not write, so verifying on every read is paying
continuously to detect an event that reads cannot cause. And SQLite surfaces genuine b-tree
damage at query time regardless, so the read path is not blind between verifies.

**What it does cost, stated honestly:** corruption arising OUTSIDE this process (disk error, an
external writer, a crash mid-write) is detected at the next transition or verify rather than at
the next read. That window is the price, and it is why the expensive half must have a real
scheduled caller rather than only an opt-in flag — a check nobody runs is a check that does not
exist.

## Acceptance

- [ ] `validate` splits into a cheap structural pass and an expensive integrity pass, with the
      split stated in the code and the reason for it
- [ ] `openIndex` runs CHEAP on a healthy existing index, and FULL on create / migrate / heal
- [ ] an explicit full-verify entry point exists for a scheduled or on-demand caller
- [ ] MEASURED: warm `greptrdd board` at 10 000 cards drops from ~1.03 s to well under the walk's
      ~1.05 s, and the query remains byte-identical (the differential in
      `tests/unit/pillar-graph-cli.test.ts` still passes)
- [ ] NEUTER: a structurally damaged index is STILL caught on open (the cheap pass), and a
      genuinely corrupt file is STILL caught by the full pass — proven by seeding each
- [ ] the cold-build cost is measured and either accepted or given its own card

## Approval log

- 2026-07-29T00:36:05+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
