---
trdd-id: O4JK6RV3
title: greptrdd must not hold the corpus either — the same defect in the second consumer
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T23:03:23+0200
updated: 2026-07-28T23:03:23+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-28T23:03:23+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
implementation-commits: []
external-refs: []
---

# greptrdd must not hold the corpus either — the same defect in the second consumer

## The hole this handles

`TRDD-BQC8NQSW` fixed the LINTER: `lib/trdd-doctor.ts::loadCorpus` held every card with `raw`
AND `body`, which at 10⁵ × ~10 KB did not run slowly — it **crashed**, exit 134 at 4.45 GB.

That fix was scoped to the linter. `scripts/greptrdd.mjs` had the identical defect and was not
touched, so the parent's 10⁵ budget was met by one consumer and missed by the other. Worse, the
CLI's version was strictly larger in blast radius: the walk ran at **top level, before the
`switch`**, so *every* subcommand paid it — `greptrdd help` walked all four zones and retained
100 000 bodies to print a usage string.

Two independent wastes, and they are separable:

| | what it cost |
|---|---|
| **eager** | `help`, `next`, `lint`, `validate` walked the corpus for nothing. `next` and `lint`/`validate` then re-walk it through `lib/trdd-doctor.ts`, which is the walk that actually answers them. |
| **body-retaining** | every subcommand held `cards[].body`. Only `show` (one STATE block) and the default search (a match count) read prose at all, and both reduce it immediately. |

## Shape of the fix

- `walkCards()` — a generator yielding `[reducedCard, body]`. The body is a **transient**: it is
  yielded, consumed, and dropped in the same iteration. Nothing here accumulates.
- `loadGraph()` — fills `cards` + `byId` from that walk, **body-free**. Called only for the five
  subcommands that need the graph (`why`, `unblocks`, `roots`, `show`, `board`).
- `show` re-reads its ONE file through `parseTrddFile` — the same store, so `null` still means
  "moved by a concurrent `git mv`" and every other read fault still throws.
- the default search **streams**: it scores each body and keeps only the count.

The loop in `loadGraph` is load-bearing and is commented as such: `[...walkCards()]` would
materialize every `[card, body]` pair at once — reinstating the exact array being deleted.

## Measured (10⁵ cards × 10 KB = 977 MB corpus, `scripts/gen-trdd-fixture.mjs`)

| subcommand | before | after |
|---|---|---|
| `help` | 8.21 s · 2.41 GB | **0.20 s · 0.07 GB** |
| `board` | 8.28 s · 2.41 GB | 8.53 s · **1.52 GB** |
| search (no match) | 8.56 s · 2.41 GB | 8.07 s · **0.47 GB** |

**Wall time is unchanged; the win is memory.** Stated that way on purpose — at 50 000 the same
pair measured `board` +12 % and search +10 %, and at 10⁵ they measured +3 % and −6 %. A quantity
whose SIGN flips between runs is noise, and calling the 50 k number a regression would have been
as wrong as calling the 10⁵ number a speed-up.

`board`'s residual 1.52 GB is not a leftover of this defect: it is 100 000 retained *cards*
(id / column / title / frontmatter), which is precisely `records` + `edges` in the SQLite index.
Removing it is the index wiring, not this card.

## Acceptance

- [x] byte-identical output — 11 invocations (`board next roots why unblocks show lint validate
      help`, a matching search, an id search), **stdout AND stderr**, `diff -r` empty
- [x] `tsc --noEmit` clean; full suite **258 files / 3873 passed / 2 skipped** (+3)
- [x] a **neuter run**: reverting the gate to an unconditional `loadGraph()` fails exactly
      ``​`help` does NOT read the corpus`` (1 failed / 10 passed) — and the positive control
      ("a graph subcommand DOES read the corpus") still passes, so the failure is about the GATE,
      not about the fixture
- [x] the fixture is **ENOTDIR**, never `chmod`: a permissions fixture passes vacuously as root

## What is deliberately NOT pinned by a test

That the walk **retains** no body. Its granularity is a heap measurement over a corpus far larger
than a unit test should build, so an assertion at unit scale would be decorative — it would pass
whether or not the bodies were dropped. It is measured instead (table above), and the fixture
generator makes that reproducible. Recorded here rather than left as an unexplained gap.

## Approval log

- 2026-07-28T23:03:23+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier-0 derived work inside the parent's own scope. No approval request was sent.
