---
trdd-id: 7CHUK1AZ
title: The cold index build holds the whole corpus in RAM to populate a table nothing reads
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-29T01:09:09+0200
updated: 2026-07-29T02:26:28+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T01:09:09+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: major
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The cold index build holds the whole corpus in RAM to populate a table nothing reads

This is the card `TRDD-4VCXRHAY`'s last open box asks for. That box measured the cold build at
**117.6 s for 10 000 cards** and said the cost "needs its own card". Measuring it at 10⁵ turned a
cost into a defect with a named mechanism.

## The mechanism — verified in source, not inferred

| step | evidence |
|---|---|
| the build parses OUTSIDE the transaction and ACCUMULATES every row first | `lib/pillar/index-build.ts:91` — `const pending: PendingRow[] = []`, filled by the loop at `:92-119` before `db.transaction` at `:155` |
| each accumulated row carries the document's FULL BODY | `:114` — `body: rec.text` |
| that body has exactly ONE consumer | `:162` `insFts.run(r.id, r.title, r.body, row.path)`. The `records` insert at `:161` takes 7 columns and **none of them is body** |
| the FTS table it feeds is **never queried by production code** | every `records_fts` reference in `lib/` and `scripts/` is a CREATE, an INSERT, a DELETE, or the parity check at `index-db.ts:471`. There is **no `MATCH` and no `bm25` anywhere outside tests** |

So the peak memory of a cold build is *the size of the corpus*, spent entirely on a structure with
no reader. The comment at `:89` explains why parsing is hoisted out of the transaction (holding the
write lock across the slow part would block every reader) — that reasoning is sound; the defect is
that the hoist RETAINS instead of streaming.

## Measured at 10⁵ (2026-07-29)

Fixture: `scripts/gen-trdd-fixture.mjs`, 100 000 cards / 10 KB bodies / 1.2 GB, the same generator
the rest of this flock uses.

| | |
|---|---|
| peak RSS | **2.36 GB**, reached during accumulation and then FLAT for the whole write phase |
| wall | **KILLED at 1h32m — it does not complete.** 10× the data of the 10⁴ run (117.6 s) had already cost **>47×** the time with no end in sight |
| CPU | `84:55` cumulative over 92 min elapsed — **92% on-CPU throughout**, state `R`. Not blocked, not deadlocked: it was working the whole time |
| main DB at kill | **4096 bytes**, mtime unchanged since the run started | 
| WAL at kill | **855 MiB**, uncommitted |

**It is not "slow", it DECELERATES — and that is the finding.** WAL growth, sampled across the run:

| point | rate |
|---|---|
| first 17 min | ~24 MiB/min (420 MB reached) |
| next 71 min | ~6.5 MiB/min |
| at 88 min (120 s window) | **3.3 MiB/min** |
| at 90 min (80 s window) | **2.25 MiB/min** |

Monotonic decay, so the run has no bounded finish: extrapolating the remaining FTS content
(~the corpus, 1.2 GB) at the *last* rate already gives 8+ hours, and the rate was still falling.
A rare operation costing ~20 min is an accepted cost; one whose completion time diverges as the
corpus grows is a defect.

**The mechanism, restated with the deceleration included.** One giant transaction means nothing
checkpoints, so every insert must locate pages through an ever-growing WAL index (`-shm` reached
1.7 MB). The WAL is not a passive log here — it is what makes each *subsequent* insert more
expensive. That compounds with the retained `pending` array: the memory wall and the time wall are
the same design decision seen from two sides.

The RSS plateau is the tell for the memory half: it stops rising exactly when `pending` is full,
which is the signature the mechanism above predicts. 2.36 GB against a 1.2 GB corpus is ~2× —
consistent with V8 string and object overhead over the retained bodies.

**Killing it cost nothing that was not already at risk.** After 92 minutes the main DB was still
4096 bytes: the entire run lived in an uncommitted transaction, so a crash, a kill, or a power
blip were all worth exactly the same. That is itself an argument for bounded batches — a build
this long with no durable intermediate state cannot survive anything.

**This is the SAME defect `BQC8NQSW` just fixed one layer over.** There, `loadCorpus` held every
card *including* `raw`, and at 10⁵ the linter did not run slowly — it CRASHED (exit 134, 4.45 GB).
The fix was to stream. The index builder has the identical shape and has not had that fix.

## Why this is not simply "drop the FTS"

It might be, and that is the likeliest outcome — but the decision is **Phase 5's**, per
`TRDD-4VCXRHAY`, because Phase 5 is where recall-by-symptom is designed and that is the only
consumer the FTS was ever built for. Deciding on cost alone, before knowing what recall needs,
would be choosing with the evidence deliberately half-read.

The two options, and the fact that separates them:

1. **Stop populating it until a consumer exists.** Cold builds get fast, the file shrinks, the
   parity check becomes trivially satisfiable, and the memory wall disappears — because `body` is
   the only large thing in `pending`.
2. **Keep it as the deliberate substrate for recall.** Then the accumulation must be fixed anyway:
   flush `pending` in bounded batches inside the transaction rather than retaining the corpus.
   Note this is a REAL constraint on option 2, not a footnote — at 2× the target the current shape
   reaches the ~4 GB heap ceiling that already killed the linter once.

Either way the accumulation is a defect. Option 1 removes it; option 2 must repair it.

## What this does NOT block

Nothing on the critical path. A cold build is the rare case, incremental syncs read only changed
files (`toRead = [...delta.added, ...delta.changed]`, `:87`), and `greptrdd`'s graph path degrades
to a measured 8.07 s walk when the index is absent (`TRDD-CTEQX0ZA`). It is filed now so the
evidence survives to Phase 5 rather than being re-derived.

## Acceptance

- [ ] Phase 5 decides the FTS's fate with recall's requirements in hand (option 1 or 2 above)
- [ ] If the FTS stays: `pending` no longer retains the corpus — bounded batches, with the peak RSS
      re-measured at 10⁵ and held under the 4 GB budget
- [ ] If the FTS goes: `body` is removed from `PendingRow`, the parity check is retired with it, and
      the cold build is re-measured
- [ ] Whichever way, the cold-build wall time at 10⁵ is stated in `TRDD-CTEQX0ZA`'s budget table

## Approval log

- 2026-07-29T01:09:09+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
