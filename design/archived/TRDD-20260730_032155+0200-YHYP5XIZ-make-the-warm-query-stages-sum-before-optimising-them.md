---
trdd-id: YHYP5XIZ
title: Make the warm-query stage timings SUM before optimising any of them
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-30T03:21:55+0200
updated: 2026-07-30T03:39:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T03:21:55+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 2
severity: minor
effort: small
release-via: none
implementation-commits: []
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# Make the warm-query stage timings SUM before optimising any of them

`TRDD-31LJK1CX` measured the warm index-backed graph query at 10⁵ and answered its own question:
the residual over the **< 1 s** budget is the O(N) freshness probe, not the query. It also decided
the three options it had floated — git short-circuit **dead** on this corpus (100 000/100 000
`stat:` identities), directory-mtime pre-filter **rejected** on an APFS measurement (an in-place
content edit leaves the directory mtime unchanged), exact probe **kept**.

**What it could not do is say where the remaining time GOES.** That is this card, and it is
deliberately *only* that until the numbers close.

## The gap, stated as arithmetic

> **SUPERSEDED by `## BUILT 2026-07-30` below — read that first.** This section states the gap as a
> fact about the pipeline. It was a fact about the INSTRUMENT: every number here came from a
> different process than the end-to-end it is compared against. On one clock the residual is 0.6%
> and the inner ~120 ms does not exist. The section is kept because it is the question this card was
> opened to answer, and because two refuted attributions are worth more as a record than as a
> deletion.

Measured in-process on the same 10⁵ non-git fixture, warm FS cache:

| stage | ms |
|---|---|
| boot + lib imports | 167 |
| `openIndex` (open + validate) | 29 |
| `listTrddFiles` (4 zones) | 162 |
| `identifyFiles` (100 000 files) | 432 |
| `cardsFromIndex` (SELECT + build) | 197 |
| **sum of the parts** | **787** |
| **end-to-end, same corpus** | **~1 050** |

**~180-260 ms is unaccounted for**, and a second gap sits *inside* `identifyFiles`: a bare loop
doing the same 100 000 `stat`s in the same shape costs 281-311 ms, so **~120 ms of the 432 is
unattributed too.**

**I proposed a cause for that inner ~120 ms twice and was wrong twice:**

| candidate | measured | verdict |
|---|---|---|
| `realpathSync` per file | 1 187 ms | REFUTED — the shipped code does a one-shot prefix remap instead (`freshness.ts:162`), so it never pays this |
| `path.resolve` per file | 28 ms | REFUTED — far too small, against a bare loop over the same already-absolute paths |

Two wrong attributions is the evidence for doing the accounting before the optimisation. An
optimisation aimed at an unattributed 120 ms is aimed at nothing.

## What is already bounded (so this card cannot drift into a fishing trip)

- The raw syscall floor is **~232 ms** for 100 000 `stat`s and is **not** payable-down — it is what
  the guarantee costs.
- Everything above that floor, across the whole pipeline, is **under ~360 ms**. That is a
  **CEILING on the prize, not a plan**: it is what a perfect fix could win, and the accounting is
  what says whether any of it is reachable.
- The output bound C069SK9E added is **not** a lever here: capping to 20 rows vs `--limit 0` moves
  the clock by nothing (`board` 1.02-1.06 s capped, 1.06-1.08 s uncapped). Rendering is nearly free.

## The order of work — accounting first, and it is a gate

1. **One process, one interleaved run, parts that SUM.** Every prior number came from a separate
   probe process, so "the parts don't add up" may be cross-process variance rather than a missing
   stage — and *that* is a hypothesis too, not an answer. Instrument the real pipeline in ONE
   process, interleave the stage timers with the end-to-end timer, and require the residual to be
   named and small.
2. **Attribute the inner ~120 ms** by measurement, on the same run. Either name the call that
   costs it, or record with evidence that it is GC/scheduler noise — a stated non-finding is an
   answer; a guess is not.
3. **Only then decide the paydown**, from what step 2 actually named. There may be no worthwhile
   fix, and "the accounting says the prize is not there" is a legitimate outcome of this card.

The boot floor is the one lever visible *without* the accounting: 167 ms of node + `tsx` startup is
~16% of the 1.05 s, is charged to every CLI invocation, and needs no change to the probe. It is
listed as a candidate, not a plan — it is also why two harnesses' absolute numbers must never be
quoted against each other (`31LJK1CX`'s originals used a 0.12 s boot; the 2026-07-30 runs go
through `scripts/with-node.sh` and pay 0.21 s).

## What must NOT change to buy the time

- **The staleness guarantee.** No heuristic pre-filter, no skipped probe, no "trust the directory".
  An index that answers confidently from a stale cache is strictly worse than a slow one.
- **`3P-IDX-07`** — an observer must not repair what it measures. Note the trap `C4YJAUD9` hit:
  `applyPragmas` sets `journal_mode = WAL`, a *persistent write*, so reusing a connection helper on
  a read-only path silently mutates the index.
- **The differential.** `tests/unit/pillar-graph-cli.test.ts` proves index-backed and walk-backed
  answers are byte-identical for all five graph verbs. That is the acceptance any change here has
  to keep green, and it is the reason a faster probe is allowed to be tried at all.

## BUILT 2026-07-30 — the accounting closed, and the budget is MET

Fixture: `scripts/gen-trdd-fixture.mjs`, 100 000 cards / 10 KB bodies / 1.2 GB at
`/tmp/trdd-fixture-100k`, **non-git** (the index's own `files.identity` says `stat:` for 100 000 of
100 000 rows). Everything runs under a contained `HOME=/tmp/yhyp-home` — the real
`~/.aimaestro/pillar-index` held 46 indexes before and 46 after. Harness: `bash scripts/with-node.sh`
throughout, n=3, warm.

### Box 1 — the parts SUM. The gap was the harness, not a missing stage.

The probe (`account-warm-query.mjs`) times every stage of `greptrdd roots`'s real path in ONE
process, against that same process's `process.uptime()`:

| stage | ms (n=3) |
|---|---|
| node boot (process start → first script line) | 97-101 |
| top-level lib imports (3, as the CLI does) | 26 |
| lazy import index-db + index-open (native `.node` dlopen) | 7 |
| lazy import index-build | 1 |
| `indexPath` + `corpusKeyFor` (1 realpath + hash) | 0 |
| `openIndex` (open + validate) | 25 |
| `syncIndex` (probe; 0 re-reads) | 555-566 |
| `cardsFromIndex` (SELECT + build 100 000 `GraphCard`) | 151-152 |
| `db.close()` | 1 |
| `cards.push(...indexed)` — spread of 100k into push | 1 |
| `new Map(cards.map(…))` — 100k array + 100k Map | 13 |
| compute roots · render | 18 · 19 |

The last four rows are the ones the earlier probe **never measured** — it stopped at
`cardsFromIndex` — and together they are 51 ms, so they were never the missing time either.

**The instrument checks out to the millisecond.** Excluding the diagnostic reconstruction layers,
the accounted stages sum to 1051 ms against a 2028 ms process wall; the 977 ms difference is
*exactly* the sum of the excluded layers (0+6+3+31+33+46+262+297+299 = 977). Nothing is unexplained.

**Compared like with like, the residual is 0.6%:**

| | ms |
|---|---|
| real CLI `roots --limit 3`, same warm corpus, n=3 | 1045 (1.04 · 1.05 · 1.04) |
| `greptrdd help` — reads nothing; the harness floor | **210** |
| ⇒ the CLI's pipeline work | **835** |
| probe's stages minus its boot (101) and minus its own extra `listTrddFiles` (121) | **829** |

Against the raw wall, the named stages account for 995 of 1045 ms — **residual 50 ms = 4.8%**,
inside the box's < 5%.

### Box 2 — the ~120 ms never existed. It was a cross-process artefact.

`identifyFiles` reads **299-306 ms** in the same process where the pipeline is measured, and a
layer-by-layer reconstruction of its own loop body reads **297-304 ms** — parity within 2-5 ms
(0.7-1.6%). The 432 ms that made the gap came from a *different* process with a different boot and
cache state; the "loop shape" it was compared against came from a *third*. Both halves of the
accounting problem — the outer 180-260 ms and the inner ~120 ms — dissolve on one clock. My two
refuted attributions were answers to a question that was never real.

| layer (cumulative, run 1) | ms | increment |
|---|---|---|
| L0 `realpathOrSelf(absRoot)` — ONE call for the corpus | 0 | — |
| L1 `gitRoot()` — a FAILING fork+exec on a non-git corpus | 6 | — |
| L2 bare `for…of` over the file list | 3 | 3 |
| L3 + `path.resolve(file)` | 31 | +28 |
| L4 + prefix remap (`needsRemap=true`) | 33 | +2 |
| L5 + `shas.get(key)` / `dirty.has(key)` on EMPTY git maps | 46 | +13 |
| L6 + `statSync` bigint + `` `stat:` `` template | 262 | **+216** |
| L7 + `out.set(file, {id, source})` | 297 | +35 |
| the shipped `identifyFiles`, for parity | 299 | — |

### Box 3 — the paydown the accounting named, and it MET the budget

L3-L5 say **43 ms** of `identifyFiles` was spent building a git lookup key and probing two git maps
that are **empty** on a non-git corpus — a fast path `gitRoot` returning `null` makes unreachable
*by design* (`freshness.ts:59`: *"every LOCAL-scope corpus is in this case"*). Hoisted:
`const canBeGit = shas.size > 0`, and the key computation moved inside it. Behaviour-preserving by
construction — with no shas there is no key to look one up BY.

`path.resolve` stayed `path.resolve`: swapping in `isAbsolute(file) ? file : resolve(file)` would
also save time and would stop NORMALIZING, so an absolute path carrying `..` would quietly cease to
prefix-match `absRoot`. The hoist already avoids the cost where it is provably pointless.

| | BEFORE | AFTER |
|---|---|---|
| `identifyFiles`, in-process, n=3 | 299 · 305 · 306 ms | **241 · 236 · 238 ms** |
| `syncIndex`, in-process, n=3 | 566 · 557 · 555 ms | 528 · 505 · 490 ms |

**I predicted 43 ms and measured 63-68.** A cumulative-layer decomposition UNDERSTATES what removing
a layer buys: skipping the resolve and the remap also skips the two ~80-char strings each allocated
and discarded per file — 200 000 dead strings the GC no longer has to chase.

**A/B on all five graph verbs, same warm corpus, the change `git stash`ed for the BEFORE column:**

| verb | BEFORE (HEAD) | AFTER |
|---|---|---|
| `roots` | 1.02 · 1.04 · 1.04 | **0.98 · 0.98** |
| `board` | 1.11 · 1.03 · 1.03 | **0.97 · 0.96 · 0.94** |
| `next` | 1.05 · 1.08 · 1.07 | **0.97 · 0.98 · 0.98** |
| `unblocks` | 1.09 · 1.00 · 1.00 | **0.97 · 0.93 · 0.93** |
| `why` | 1.01 · 1.07 · 1.01 | **0.96 · 0.95 · 0.97** |

**Every one crosses from ≥1.00 s to ≤0.98 s.** That is the `< 1 s` budget `TRDD-CTEQX0ZA` set and
`31LJK1CX` recorded as missed — met by a 6-line hoist, with the probe's guarantee untouched.

### Four neuter runs, and THREE of them passed — the finding is about my own test

| neuter | result |
|---|---|
| `canBeGit = false` | **4 named tests FAIL**, including the file's own positive control (*"identity on the LIVE corpus — without it every case below is vacuous"*). The git fast path is genuinely covered; the hoist did not silently kill it. |
| `canBeGit = root !== null` | **PASSES.** Behaviour is identical — the gate choice is performance-only. |
| drop the `sha &&` miss-check | **PASSES** with the hoist in place (an empty repo never enters the branch); the pre-existing untracked-file test kills it when the branch *can* be entered. |

So the test I wrote to "pin the hoist" — *an empty repo still identifies by stat* — was **vacuous
against every single mutation I could construct**, and I removed it rather than ship a comment
claiming it pinned something. No behavioural test can distinguish `shas.size > 0` from
`root !== null`, because the difference is only cost. The existing 11 pillar/TRDD test files
(including the index-vs-walk differential) plus the full suite (275 files / 4105 passed / 2 skipped)
are the gate; `tsc --noEmit` clean; `validate` 0 / 0 ERRORs, `trdd:doctor` 0, `pillars:lint` 0.

### What is LEFT, named and unclaimed

- **The harness floor: 210 ms, ~21% of the 0.98 s.** `greptrdd help` reads nothing and costs that
  much — node + `tsx` boot plus greptrdd.mjs's own transpile and imports. It is now the largest
  single item, and it needs no change to the probe or the guarantee. **Not this card's work:** it
  affects *every* subcommand, not just the graph verbs, and the fix is a different kind of change
  (a build/bundle step, or a resident process). Left for whoever picks it up, with the number.
- **The probe is now within ~20 ms of its own syscall floor** (216 ms of the 236 ms `identifyFiles`
  costs is `statSync`). There is essentially nothing left to take there without weakening the
  guarantee, which retires that avenue rather than deferring it.
- `listTrddFiles` 121 ms, `syncIndex`'s own diff 134 ms, `cardsFromIndex` 151 ms — measured, none
  large enough to matter now that the budget is met.

## Acceptance

- [x] ONE in-process instrumented run on a 10⁵ fixture where the stage parts SUM to that same run's
      end-to-end, with the residual named and < 5% of the total. State the fixture, the Node
      wrapper, and n. — **0.6%** comparing pipeline-work to pipeline-work (835 vs 829 ms), **4.8%**
      against the raw CLI wall; fixture, wrapper and n stated above
- [x] The ~120 ms above the raw-stat loop shape inside `identifyFiles` is either ATTRIBUTED to a
      named call or recorded as noise with the evidence that shows it. No third guess. — **neither:
      it does not exist.** On one clock `identifyFiles` is 299-306 ms and a faithful reconstruction
      of its own body is 297-304 ms (parity 0.7-1.6%); the 432 ms and the 281-311 ms it was compared
      against came from two other processes. The layer table above attributes every millisecond it
      does cost
- [x] A paydown decision that follows from the accounting — implemented if the accounting names a
      reachable win, or recorded as "not worth paying" with the numbers that say so. — **implemented**:
      the `canBeGit = shas.size > 0` hoist, named by layers L3-L5, `identifyFiles` 299-306 → 236-241 ms
- [x] If anything shipped: all five graph verbs still byte-identical index-vs-walk (the existing
      differential, unchanged), and a re-measured 10⁵ number against the < 1 s budget. — differential
      green untouched (`pillar-graph-cli.test.ts`; full suite 275 files / 4105 passed / 2 skipped),
      and all five verbs re-measured against a stashed BEFORE: every one crosses ≥1.00 s → ≤0.98 s
- [x] The staleness guarantee is intact — no heuristic, no skipped probe, `3P-IDX-07` green. — the
      probe still `stat`s every file; the hoist only skips key-building for a branch that cannot be
      taken, and the `canBeGit = false` neuter proves the git path is still live (4 named tests fail)

## Approval log

- 2026-07-30T03:21:55+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: a Tier-0 self-mandate, sibling EHT of `L55IYKL4`. No approval request was sent.
