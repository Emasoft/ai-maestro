---
trdd-id: 4VCXRHAY
title: The index validates the whole corpus on every open and that is the scaling wall
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-29T00:36:05+0200
updated: 2026-07-30T01:36:00+0200
implementation-commits: [d04ee6a6, 916e729b]
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

## CLOSED 2026-07-30 — all 6 boxes were met a day ago; the card was simply never advanced

Found while picking the next piece of work: `column: dev`, every box `[x]`, `npt`/`eht`/`blocked-by`
all empty, and no `implementation-commits:` field at all — so the SHAs that landed it (`d04ee6a6` the
split, `916e729b` the measurement) were recorded nowhere, which is the one field that makes a bug
found later traceable to the change that introduced it. Both now recorded.

The work was re-verified FIRST-HAND against the current code rather than taken from the boxes:
`ValidateDepth = 'structural' | 'full'` exists, `validate()` keeps the strong name for the full pass,
`validateStructural()` is the cheap one, and `openIndex` defaults `depth = opts.verify ?? 'structural'`.
Its spun-off card `7CHUK1AZ` (the cold-build cost) is complete and archived.

**ONE THING THIS CARD ARGUED AND DID NOT DELIVER, now its own card.** The body says the split is only
safe if *"the expensive half must have a real scheduled caller rather than only an opt-in flag — a
check nobody runs is a check that does not exist."* Grepping every non-test caller of the full pass
across `lib/ scripts/ app/ services/ server.mjs` returns exactly one: `scripts/bench-cold-index.mjs`,
a BENCHMARK. So box 3 is satisfied as WORDED (an entry point exists) while the principle the same
paragraph states is not. Closing the card silently would have ratified the gap it named.

Spun out as **`TRDD-C4YJAUD9`** — a SIBLING EHT under `L55IYKL4`, not a child, because a derived TRDD
is depth-1 and may not spawn its own. That is the same route this card used for the cold-build cost
(`7CHUK1AZ`), so the pattern is consistent rather than invented here.

⚠️ **The line citations in the section below are ROTTEN and are kept as the historical record:**
`index-build.ts:91 / :114 / :162` were true at measurement time. `TRDD-7CHUK1AZ` removed the FTS
write and `TRDD-YN8EQWYP` moved the parse inside an `IMMEDIATE` transaction, so those numbers now
point at unrelated code. Read them as "what was there on 2026-07-29", never as a current pointer.

## Acceptance

- [x] `validate` splits into a cheap structural pass and an expensive integrity pass, with the
      split stated in the code and the reason for it (`ValidateDepth`, `d04ee6a6`)
- [x] `openIndex` runs CHEAP on a healthy existing index, and FULL on create / migrate / heal
- [x] an explicit full-verify entry point exists for a scheduled or on-demand caller
      (`validate` keeps the strong name; `openIndex(file, { verify: 'full' })` opens-and-verifies)
- [x] MEASURED: warm `greptrdd board` at 10 000 cards **1.03 s → 0.37 s**, against the walk's
      1.12 s — a 3× win where there had been none. Live 298-card corpus: the 30 ms penalty is
      gone. Byte-identity holds on the 10 000-card fixture (4291 lines, empty diff)
- [x] NEUTER (make `depth` inert): fails exactly the two discriminating tests, while the two
      "structural still catches X" tests correctly stay green — those faults are caught at both
      depths, which is the point
- [x] the cold-build cost is measured and either accepted or given its own card — **GIVEN ITS OWN
      CARD: `TRDD-7CHUK1AZ`.** Re-measuring at 10⁵ turned the cost into a defect with a named
      mechanism: the build ACCUMULATES every parsed row before its transaction
      (`index-build.ts:91`) and each row retains the document's full `body` (`:114`) whose only
      consumer is the FTS insert (`:162`) — so peak RSS is the size of the corpus (**2.36 GB at
      10⁵, flat once accumulation ends**), spent entirely on a table with no reader. That is the
      same shape `BQC8NQSW` fixed one layer up, where it was a 4.45 GB crash

## FOUND WHILE MEASURING — the FTS has no reader at all

`syncIndex` writes every document's full body into `records_fts`, and that is what dominates the
117.6 s cold build (~98 MB of prose through the tokenizer). **Nothing queries it.** The default
regex search is walk-only by design and always will be, and the graph subcommands read
`records`/`edges`. The one thing that touches `records_fts` is the parity check that exists to
verify it.

So the FTS is currently a write-only structure: it costs the whole cold build, it is the largest
part of the file on disk, and it is verified by a check whose cost this card just rescheduled.
That is the accretion line — *a column enters `records` only when an INDEX-SERVED subcommand
reads it* — violated one table up, by a table that predates the line.

Two defensible options, and picking between them is its own card: stop populating it until a
consumer exists (fast builds, smaller file, parity trivially satisfied), or keep it as the
deliberate substrate for a future recall-by-symptom capability the parent exists to add. Do NOT
decide it here — the parent's Phase 5 is where recall is designed, and that is what makes the
call informed.

## Approval log

- 2026-07-29T00:36:05+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
