---
trdd-id: 7CHUK1AZ
title: The cold index build holds the whole corpus in RAM to populate a table nothing reads
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-29T01:09:09+0200
updated: 2026-07-29T20:25:31+0200
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

## Measured AFTER the fix (2026-07-29) — the number the kill could not produce

Same generator and same fixture as the kill above (`scripts/gen-trdd-fixture.mjs`, 100 000 cards /
10 KB bodies / 1.2 GB), same three calls (`openIndex` → `syncIndex` → `validate`), driven by
`scripts/bench-cold-index.mjs`. Serial, uncontended, caps interleaved, n=3.

| | before (the kill) | after |
|---|---|---|
| wall | **KILLED at 1h32m** — no bounded finish | **11.0 s · 11.7 s** (reps 2-3; rep 1 warm-up 16.5 s) |
| peak RSS | 2.37 GB | **1.25-1.29 GB**, or **0.28-0.32 GB** under `--max-old-space-size=256` |
| main DB at end | **4096 bytes** — the whole run in an uncommitted WAL | **67.8 MB** · `validate: ok` · 100 000 records |

**That RSS is CHURN, not a live set — and only a heap CAP can prove it.** RSS counts uncollected
garbage, so it cannot answer "how much is RETAINED". Capped to 256 MB — one fifth of the uncapped
peak — the build still COMPLETES, three times, same 100 000 records, same clean validate.
Completion under a cap is a boolean that GC timing and scheduler luck cannot fake. The cap costs
~1 s (12.0-12.3 s vs 11.0-11.7 s). So the retained set is genuinely small now, and the old 2.36 GB
was the corpus being HELD.

**Two numbers here were wrong before they were measured, and both were mine.** The first run read
33.29 s — it started the instant its 1.2 GB fixture landed, so it was paying the filesystem's
write-back. Then two probes I launched OVERLAPPED, and the same capped configuration read 17.35 s
and 111.56 s; from the fast one I briefly concluded a tighter cap was ~2× FASTER. It is not. Both
are recorded in `.claude/rules/lessons-verification.md`, because a benchmark measures its
ENVIRONMENT until you make it stop.

## The three budget rows this card was blocking (`TRDD-CTEQX0ZA`)

`CTEQX0ZA` deferred three rows with **"not measurable at 10⁵ (needs a built index) → blocked on
`TRDD-7CHUK1AZ`"**. A cold build now completes there, so all three are measurable — including the
two INTERACTIVE ones, which are the whole reason to have an index at all; the cold-build row only
says one can be created.

They are stated HERE, not there, because `CTEQX0ZA` reached `column: complete` and moved to
`design/archived/` at 02:26 today — hours before this measurement existed — and rule 12 freezes a
terminal card's body. Writing into it would be the edit that rule forbids.

Measured with `greptrdd roots --design-dir <fixture>` under a **contained `$HOME`**: the index
lives at `statePath('pillar-index')` and `getStateDir()` has NO env override, so `$HOME` is the
only lever (`os.homedir()` honours it on POSIX). Node is resolved FIRST under the real `$HOME`
because `pin-node.sh` searches home-rooted toolchains. Containment is measured, not asserted — the
real `pillar-index` held **35 entries before and 35 after**, and the positive control shows the
71 MB index in the fake one.

| row | budget at 10⁵ | measured at 10⁵ | verdict |
|---|---|---|---|
| cold full index build | < 4 GB, and it must COMPLETE | 11.0-11.7 s · 1.25-1.29 GB · `validate: ok` | **MET** |
| graph query, INDEX warm | **< 1 s** | **1.13-1.17 s** end-to-end (~1.02 s of work over a 0.12 s boot floor), against **8.07 s** for the walk | **NARROWLY MISSED** — 7× the walk's speed, still over budget |
| incremental reindex, 1 file changed | ~O(1) work + an O(N) freshness probe | **1.14 s** — indistinguishable from warm | **MET, and it says something** |

**The last two rows are ONE cost, and it is not the query.** Decomposing the warm 1.14 s (n=3,
`/private/tmp/warm-decompose.mjs`): boot 0.12 s · open 0.03 s · **freshness probe 0.59 s**
(`syncIndex` over 100 000 files, 0 re-read) · SELECT + 100 000 cards 0.20 s · remainder = computing
`roots` and rendering 7 782 rows. The probe is the single largest line item, and editing one card
adds **nothing measurable** on top of it — which is exactly why `incr` equals `warm`.

So **the lever on the sub-second budget is a cheaper staleness check, not SQL.** That is a finding,
not a defect: `CTEQX0ZA` budgeted the probe as O(N) deliberately. It gets its own card rather than
being fixed here, because this card's subject is the cold build — and a MISSED budget with no owner
is how findings evaporate.

## Acceptance

- [x] Phase 5 decides the FTS's fate with recall's requirements in hand — **OPTION 1, 2026-07-29.** The requirements are in hand and they are negative: the FTS's only intended consumer is recall/search, search takes a REGEX (`scripts/greptrdd.mjs`, `new RegExp(cmd, 'i')`) which FTS5 structurally cannot serve, and the graph subcommands were index-backed instead with search ratified walk-only. So it was never a table awaiting a consumer — it was mis-designed for the consumer it had. Against that, keeping it costs a cold build that does not complete at the stated target. Implemented as the option words it: STOP POPULATING; table, migrations and shape check all stay, so restoring it is one INSERT.
- [x] If the FTS stays: `pending` no longer retains the corpus — bounded batches, with the peak RSS
      re-measured at 10⁵ and held under the 4 GB budget — **N/A, the FTS did NOT stay.** The box is
      conditional on option 2 and option 1 was taken, so it is vacuously satisfied; it is ticked
      rather than deleted so the branch that was NOT taken stays visible in the record.
- [x] `body` removed from `PendingRow` (the whole memory wall — it was the only large retained field) and the parity check retired in `index-db.ts`, because over an always-empty table it is satisfied by construction: a gate that passes because it read nothing. tsc clean; 49/49 pillar tests; a NEUTER run (re-add the INSERT) turns the new pinning test red, restored byte-clean.
- [x] The cold build is re-measured at 10^5 — **11.0-11.7 s · 1.25-1.29 GB · 100 000 records · `validate: ok`**, against KILLED-at-1h32m before. Serial and uncontended, n=3, caps interleaved; the retention half proven by a 256 MB heap cap the build still completes under. Full table above.
- [x] Whichever way, the cold-build wall time at 10⁵ is stated in `TRDD-CTEQX0ZA`'s budget table — **the named destination became unwritable and the number is stated HERE instead.** `CTEQX0ZA` reached `column: complete` in `design/archived/` at 02:26 today, hours before this measurement existed, and rule 12 freezes a terminal card's body. I did not edit it. All THREE rows it had marked "blocked on `TRDD-7CHUK1AZ`" are re-stated above with their verdicts (two MET, one NARROWLY MISSED) — an acceptance box whose destination is another card can be voided by that card going terminal first, which is now a lesson.

## Approval log

- 2026-07-29T01:09:09+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
- 2026-07-29T20:25:31+0200 — COMPLETED by ai-maestro. Every box ticked; the cold build is measured
  at 10⁵ and completes in ~11 s where it previously did not finish at all. `npt:`/`eht:` are empty
  (depth-1 derived), so no flock gates this. The one budget row that is MISSED is handed to its own
  card rather than left unowned here.
