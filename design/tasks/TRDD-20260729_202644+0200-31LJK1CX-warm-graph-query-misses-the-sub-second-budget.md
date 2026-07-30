---
trdd-id: 31LJK1CX
title: The warm graph query misses the sub-second budget and the freshness probe is why
column: blocked
pre-block-column: dev
scope: project
project-id: ai-maestro
created: 2026-07-29T20:26:44+0200
updated: 2026-07-30T03:23:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T20:26:44+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 2
severity: minor
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: [YHYP5XIZ]
external-refs: []
---

# The warm graph query misses the sub-second budget and the freshness probe is why

`TRDD-CTEQX0ZA` set **< 1 s** for a warm index-backed graph query at 10⁵ and wrote *"this is the
whole point of having one"*. It could not measure it — the cold build did not complete at 10⁵, so
the row read **"blocked on `TRDD-7CHUK1AZ`"**. `7CHUK1AZ` has now made the cold build finish, the
row is measurable, and the answer is: **1.13-1.17 s. Narrowly over.**

## The measurement, and the decomposition that makes it actionable

Fixture: `scripts/gen-trdd-fixture.mjs`, 100 000 cards / 10 KB bodies / 1.2 GB. Command:
`greptrdd roots --design-dir <fixture>` under a contained `$HOME`, n=3.

| component | cost | what it is |
|---|---|---|
| boot floor | 0.12 s | node + tsx start-up, charged to every run, buys nothing |
| `openIndex` | 0.03 s | open + validate the SQLite index |
| **freshness probe** | **0.59 s** | `syncIndex` over 100 000 files, **0 re-read** — pure staleness checking |
| `SELECT` + build cards | 0.20 s | 100 000 rows out of the index into `GraphCard[]` |
| remainder | ~0.20 s | computing `roots` + rendering 7 782 rows |
| **total** | **1.13-1.17 s** | vs a **< 1 s** budget, and vs **8.07 s** for the walk |

**The probe is the single largest line item, and the query is not the problem.** The corroborating
fact is the sibling row: editing exactly one card and re-running costs **1.14 s** — indistinguishable
from warm. Editing a file adds nothing measurable, because the O(N) probe is paid either way. Two
budget rows, one cost.

## What this is NOT

**Not a regression, and not a defect in the index.** `CTEQX0ZA` budgeted the probe as
*"~O(1) work + an O(N) freshness probe"* — deliberately, and the O(N) half is doing exactly what it
was designed to do. The index delivered what it promised: it removed THE WALK (8.07 s → 1.14 s, a
7× cut) and made the query itself cost 0.20 s. What is left over budget is the cost of *proving the
cache is still valid*, which is a different problem from *answering the question*.

**Not urgent.** 1.14 s is interactive. This is filed because a MISSED budget with no owner is how a
finding evaporates — not because anything is broken today.

## The direction, stated as a question rather than a design

The lever is a **cheaper staleness check**, not SQL. The open question is what can stand in for
100 000 `stat` calls without weakening the guarantee:

- a corpus-level short-circuit (one `git rev-parse HEAD` + a dirty check) that skips the per-file
  probe when the tree provably has not moved — but LOCAL-scope corpora are in no repo at all
  (`TRDD-CTEQX0ZA` E6), so it cannot be the only path;
- a directory-mtime pre-filter, which is cheap but is a HEURISTIC — and an index that trusts a
  heuristic answers confidently from a stale cache, which is strictly worse than being slow;
- accepting the probe and moving the boot floor + rendering instead (0.32 s of the 1.14 s is
  neither probe nor query).

Whatever is chosen, it must keep the property the index was built to have: **an accelerator, never
an authority.** A staleness check that can be wrong converts a fast answer into a wrong one, and
the differential test (`tests/unit/pillar-graph-cli.test.ts`) is what any change here has to keep
green.

## ADDENDUM 2026-07-30 — `TRDD-C069SK9E` re-measured this, and REFUTED one row of the table above

C069SK9E bounded the list verbs (`--limit`, default 20) and index-backed `next`, which gave a clean
A/B on the one attribution this card guessed at.

**The decomposition row *"remainder ~0.20 s = computing `roots` + rendering 7 782 rows"* credits
rendering with a cost it does not have.** On a fresh 10⁵ fixture, capping the output to 20 rows
changes the wall clock by nothing:

| verb | default cap (20 rows) | `--limit 0` (all rows) |
|---|---|---|
| `board` | 1.02 · 1.06 s | 1.06 · 1.07 · 1.08 s |
| `roots` | 1.03 · 1.05 s | 1.05 · 1.07 · 1.10 s |

So the residual over budget is the **freshness probe alone** — this card's actual subject — and the
bound C069SK9E added is a usability fix, not a performance one. Worth stating because the two are
easy to conflate: 100 000 lines of output is unusable *and* nearly free.

**Two more datapoints that narrow the target:**

- **`unblocks` MEETS the budget** at 0.98-1.00 s, while `roots`/`board`/`why`/`next` sit at
  1.01-1.11 s. Every one of them pays the same O(N) probe, so the ~0.05 s that separates them is the
  per-verb compute — small, and NOT where the fix is.
- **`next` is now inside the same band** (17.1 s → 1.03-1.08 s), so all five graph verbs are
  uniformly probe-bound. Whatever replaces the probe fixes all of them at once, which is what makes
  this card the single remaining lever on `C069SK9E`'s box 1.

**Do not read the absolute numbers against this card's originals.** Its 1.13-1.17 s was taken with a
**0.12 s** boot floor; the 2026-07-30 runs go through `scripts/with-node.sh` and pay **0.21 s**. Two
harnesses, both correct, ~0.09 s apart before any work is done — quoting one against the other would
manufacture a change that did not happen.

## ADDENDUM 2026-07-30 (later) — the non-git decomposition, and the design question ANSWERED

### Box 1 — the corpus really is the case a git short-circuit cannot serve

Not inferred from its location: the index's own `files.identity` column says
**`stat:` for 100 000 of 100 000 rows** (`stat:<size>:<mtime_ns>`), zero `git:`. So a
`git rev-parse HEAD` short-circuit would have saved **nothing at all** here — the card's own
prediction, now a measurement rather than a caveat. `freshness.ts:59` states the general case:
*"Not a git repo — every LOCAL-scope corpus is in this case, by design."*

**The stage table** (in-process, 10⁵ non-git corpus, second run = warm FS cache):

| stage | ms | what it is |
|---|---|---|
| boot + lib imports | 167 | node + tsx, charged to any CLI invocation |
| `openIndex` (open + validate) | 29 | |
| `listTrddFiles` (4 zones) | 162 | 4 `readdir`s + sort |
| `identifyFiles` (100 000 files) | 432 | the `stat` probe |
| `cardsFromIndex` (SELECT + build) | 197 | 100 000 rows → `GraphCard[]` |
| **real work (excl. boot)** | **817** | of which the probe is **591 = 72%** |

`syncIndex` reported `scanned: 100000, added/changed/removed: 0, records: 0, edges: 0` — zero
re-reads, pure staleness checking. And it cost **591 ms** against my own separate
list+identify of **594 ms**, which cross-checks the attribution: `syncIndex`'s cost *is*
list+identify, essentially entirely.

### The three options this card floated, each now decided on evidence

**1 · git short-circuit — DEAD on this corpus.** See above: no git identities exist to short-circuit.

**2 · directory-mtime pre-filter — REJECTED, and now on measurement rather than suspicion.**
Tested on APFS: an **in-place content edit leaves the directory mtime UNCHANGED**
(`1785373641.749577506` before and after), while adding a file changes it. An in-place edit is
how a TRDD *normally* changes — bump `updated:`, flip `column:` — so this filter would skip the
probe in exactly the common case and answer confidently from a stale index. That is the failure
the card named as "strictly worse than being slow", and it is not a corner case but the modal one.

**3 · accept the probe and attack the rest — CHOSEN, and it turns out not to require weakening
anything.** The card assumed "cheaper staleness check" meant *weaker*. It does not: **60% of the
probe is not the check.**

- The stat FORM is not the cost. Four variants over the same 100 000 files:
  `bigint` (shipped) **228 ms** · `number mtimeMs` 251 · `+ throwIfNoEntry:false` 242 ·
  `lstat` 246 — all ~2.3-2.5 µs/file, and **the shipped form is the fastest**. There is no free
  win in how the stat is called.
- So **~232 ms is an irreducible syscall floor** for "verify every file", and the shipped loop
  shape (stat + identity string + `Map<path,{id,source}>` + per-file try/catch) measures
  **281-311 ms** — the try/catch is free, the 100k-object Map costs ~54 ms.
- `identifyFiles` measures **432 ms**, so **~120 ms sits above the loop shape — and it is NOT yet
  attributed.** Two candidates proposed and both REFUTED: the git-root probe fails fast in **7 ms**,
  and the per-file `path.resolve(file)` costs **28 ms** (measured against a bare loop over the same
  100 000 paths, which are all already absolute). Neither is the bulk.

**Wider than that: the measured parts do not SUM to the whole.** 167 boot + 29 open + 162 list +
232-311 identify + 197 select = **787-866 ms** against a ~1.05 s end-to-end, so **~180-260 ms is
unaccounted for across the pipeline**, not merely inside `identifyFiles`. Some of that is
cross-process variance (the stage probe and the loop-shape probe ran in different processes with
different GC and FS-cache states), but "some of it is variance" is a hypothesis too.

**So the paydown target is NOT yet specified well enough to build.** The sibling card's FIRST job is
to close this accounting gap — one process, one interleaved run, parts that sum — because an
optimisation aimed at an unattributed 120 ms is aimed at nothing. I proposed a cause for that gap
twice and was wrong twice, which is the evidence for doing the accounting before the fusing.

**A false lead worth recording, because reading the code is what killed it.** I measured
`realpathSync` per file at **1 187 ms** and nearly reported it as the overhead. The shipped code
does not do that — `freshness.ts:162` does a **prefix remap**: ONE `realpath` for the corpus root,
then a string slice per file, precisely so the all-clean path stays free of per-file I/O. A probe
can measure a cost the code deliberately avoids, and the number looks just as real.

### The decision, with its failure mode stated

**Keep the exact O(N) probe — every file stat'ed, no heuristic — and pay down the userland work
around it.** Failure mode: **none**, because the check itself is unchanged; the guarantee that the
index is an accelerator and never an authority is preserved by construction. What it costs is
engineering, not correctness.

**The SIZE of that paydown is bounded but not yet apportioned.** Bounded below by the ~232 ms syscall
floor, and bounded above by the ~591 ms probe — so there is somewhere under ~360 ms of non-syscall
work to reclaim, and if all of it went the whole-board verbs would land near ~620 ms end-to-end,
**inside the < 1 s budget with no heuristic anywhere.** But which code that ~360 ms is in remains
open (see the accounting gap above), so the number is a CEILING on the prize, not a plan.

**A second, independent lever for the LOCAL verbs.** `why`/`unblocks`/`show` depend only on one
card's transitive blocker chain, so freshness could be verified **as each node is visited** rather
than for the whole corpus. The induction is sound: if X is fresh then X's edge list is current, so
the footprint discovered from X is the true footprint. It fixes 3 of 5 verbs completely (a ~3-node
chain on the live corpus) and `roots`/`board`/`next` not at all, since their answer genuinely
depends on every card.

**Neither is done here.** This card's acceptance was to decompose, choose, and re-state the verdict;
the paydown is a sibling under `L55IYKL4` (depth-1 forbids this card having children of its own),
and until that sibling exists the miss keeps its owner rather than evaporating.

## Acceptance

- [x] The warm-query cost is decomposed against a corpus that is NOT in a git repo, since that is
      the case a git-based short-circuit cannot serve — **proven non-git by the index's own
      `files.identity`: `stat:` for 100 000 of 100 000 rows**, and decomposed stage by stage above
- [x] A staleness check is chosen with its failure mode stated explicitly — what input makes it say
      FRESH when the corpus moved, and why that is acceptable or impossible. **Chosen: the exact
      O(N) probe, unchanged, so the failure mode is NONE.** The rejected alternative is stated with
      the input that breaks it: a directory-mtime filter says FRESH after any in-place edit
      (measured on APFS — dir mtime unchanged), which is the modal way a TRDD changes
- [x] The differential test still passes: index-backed and walk-backed answers agree on the live
      corpus, ORDER included — full suite green (275 files / 4105 passed), and `C069SK9E` extended
      it to `next` **and to 10⁵**, byte-identical over 31 111 ranked rows
- [x] Warm query re-measured at 10⁵ and the verdict re-stated — **MISSED, with the residual bounded**:
      591 ms of 817 ms real work is the probe, of which **~232 ms is an irreducible syscall floor**,
      leaving **under ~360 ms of non-syscall work** as the ceiling on any paydown. The budget is
      therefore reachable without a heuristic. Where that ~360 ms LIVES is deliberately left open —
      two proposed causes were measured and refuted, and the parts do not yet sum to the whole, so
      apportioning it is the sibling card's first job rather than a guess recorded here

## BLOCKED on `TRDD-YHYP5XIZ` — 2026-07-30

Every box above is answered, and the **budget is still missed** — so this card is not `complete`,
it is `blocked` (`pre-block-column: dev`). What it owed was the diagnosis and the decision, and both
landed: the probe is the residual, the three floated options are decided on evidence, and the prize
is bounded under ~360 ms of non-syscall work.

What it cannot do is claim the budget met, because the paydown target is not yet specified well
enough to build — the stage parts do not sum to the whole, and the inner ~120 ms has survived two
refuted attributions. `YHYP5XIZ` closes that accounting first (one process, one interleaved run,
parts that sum), and only then decides the paydown. When it reports, this card either meets the
budget or records — with numbers — that the prize was not reachable.

## Approval log

- 2026-07-29T20:26:44+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
