---
trdd-id: L55IYKL4
title: Adopt the wikimem/memgrep solutions into the 3-pillars system and its grep tool
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-26T15:51:58+0200
updated: 2026-08-22T02:15:41+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-26T15:51:58+0200
relevant-rules: [R25]
blocked-by: []
npt: [Q3GZJI1X, LXLK7XGX, 7JK3NCV4, CTEQX0ZA]
eht: [BQC8NQSW, C069SK9E, 8KDIB2LT, MUYRIKN3, YN8EQWYP, O4JK6RV3, 4VCXRHAY, 7CHUK1AZ, 31LJK1CX, C4YJAUD9, YHYP5XIZ, SCMPWF6R, FKGMNGJB, 217AYEOT]
external-refs: [Emasoft/ai-maestro#96, Emasoft/ai-maestro#98, Emasoft/ai-maestro-janitor#118, Emasoft/ai-maestro-janitor#123, Emasoft/ai-maestro-janitor#126, Emasoft/ai-maestro-janitor#127]
---

## ⏱ EXTERNAL REFS CHECKED 2026-08-02 — both janitor asks are CLOSED, and one of them SHIPPED THE SPEC

Surfaced by the external-ref sweep on [[5YRLA53W]]. This card cites four janitor issues; **`#118`
and `#123` closed on 2026-07-28** and nothing here records it.

- **`janitor#118` — the ask for a CURRENT normative wikimem/memgrep spec — was ANSWERED and the
  artefact SHIPPED:** `design/specs/wikimem-memgrep-spec.md`, **~1300 lines / 180 `WM-*` rules**, in
  every janitor release **from v0.62.0**. Two rules were added after that answer and are worth
  knowing before adopting anything: **`WM-ATOM-02a`** (the documenting GRAMMAR must not DECLARE
  atoms — it was minting 13 phantom atoms in the USER index) and **`WM-BENCH-07a`** (the binary-pin
  rule binds every test that shells out, not only the benchmarks).
  **Their own diagnosis of the confusion matters more than the fix:** the file genuinely had **0
  lines** in the v0.60.1 that was cached here, so the earlier reading was not a misreading — it was
  a correct read of a stale cache. Re-fetch at ≥ v0.62.0 before concluding anything about the model.
- **`janitor#123`** — `memgrep validate` reporting a merely-behind DB as a critical `MEMGREP-004`
  migration failure — closed with a **correction to its own first explanation**: the re-firing is
  not a cached finding but a legitimate **retry ladder** (`close --status FAILED` routes through
  `mark_failed`, which increments `attempts` and returns the ticket to `OPEN` with a backoff, or
  `needs_human` at the cap). The ticket store is **project-local at `.janitor/state/tickets/`**, not
  in the plugin DATA dir — which is why an earlier search for it came up empty.

`#126` and `#127` were re-checked in the same sweep and are still **OPEN**.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-28

**UNBLOCKED.** The artefact this TRDD was waiting for landed: **`Emasoft/ai-maestro#96` — "Transfer:
12 measured design laws from the wikimem retrieval engine"** (2026-07-26), with `#98` (3-pillars
guidance) beside it. Read #96 before touching anything here; L2, L7, L8 and L10 are the load-bearing
ones.

**USER mandate 2026-07-28:** *"report every issue to the janitor github repo. make sure adopt
stronger safety mechanisms for the trddgrep, prrdgrep and specsgrep indexer db. make the whole thing
a lesson learned and improve the code accordingly. we need the 3-pillar system working and solid as
a rock."* Full plan: `~/.claude/plans/iterative-foraging-wadler.md` (top section).

### Decisions taken (USER-set; do not re-litigate)

- **Scale target is 10⁵ documents.** I measured 298 TRDDs / 3.0 MB → `validate` in 0.57 s and
  recommended staying stateless; the USER overruled it on the growth curve — *"when you will get
  100000+ TRDDs, PRRDs, and specs … without a db the search will become slow."* Correct. **Build
  the DB.**
- **SQLite + FTS5**, memgrep-shaped safety (FTS5 confirmed available in the bundled
  `better-sqlite3`, SQLite 3.51.3; `('integrity-check', 1)` parity form works).
- **A shared `lib/pillar/` seam** serving all three pillars; `lib/trdd-store.ts` is re-expressed on
  it with its **public API frozen**, so its **28** existing tests passing unchanged is the proof the
  abstraction fits. (Its shape is set by F2 below — document→records, not one-file-one-doc.)
- **Two of memgrep's postures are deliberately NOT copied** — full-walk fallback (at 10⁵ the
  fallback IS the outage → incremental repair) and per-file `git hash-object` (→ one
  `git ls-files -s`). Recorded in CTEQX0ZA.

### The flock (authored 2026-07-28; the parent is not `complete` until every EHT is terminal)

| kind | id | what |
|---|---|---|
| NPT | `Q3GZJI1X` | `relevant-rules:` cites two catalogues in two syntaxes across 234 cards — resolve BEFORE a `PRRD.md` makes `[25]` ambiguous |
| NPT | `LXLK7XGX` | the DAG constrains **frontmatter** edges, not prose — 18 live provenance mentions in specs are not violations |
| NPT | `7JK3NCV4` | choose the fail-loud posture once at the store API seam |
| NPT | `CTEQX0ZA` | write the 10⁵ budget down before designing the index |
| EHT | `BQC8NQSW` | the linter holds the whole corpus (`raw` per card) — ~1 GB at 10⁵ |
| EHT | `C069SK9E` | graph + board at 10⁵ |
| EHT | `8KDIB2LT` | propagate the new CLI contract (exit trichotomy, `--design-dir`, two new tools) |
| EHT | `MUYRIKN3` | the spec bump 1.1.1 → 1.2.0 is consumed by the janitor (`3P-CHK-03`, `3P-VER-02`) |
| EHT | `YN8EQWYP` | the index is new shared server state — register it, handle N writers, contain the tests |
| EHT | `YHYP5XIZ` | (added 2026-07-30, **complete**) make the warm-query stage timings SUM before optimising any of them — closed the accounting AND met the budget |

### Two findings that CHANGE the seam design (2026-07-28, both verified first-hand)

**F1 — the reference JOIN, not the walk, is the scale problem.** USER's second correction:
*"every reference in the TRDD must be validated … extremely inefficient if made directly instead of
doing it via a ready to use index with all references already in it."* Verified: the linter ALREADY
builds an index in RAM every run (`trdd-doctor.ts:188/193/196`) — that is *why* the corpus is
resident, so the 6.5 GB measured at 10⁵ **is** the index. Cross-pillar validation does not exist yet
(grep: zero spec-clause/PRRD checks), so Phase 4 WIDENS the join to three corpora. And `findTrdd`
re-readdirs all four zones **per call**, so a cross-pillar lint written on the public API is O(N²).
⇒ **the index must store resolved reference EDGES, not just documents.** Full record: `CTEQX0ZA`.

**F2 — the three pillars have THREE document models. `kinds.ts` as planned does not fit.**
Measured on disk, not assumed:

| pillar | corpus | queryable UNIT | where the id lives | zones |
|---|---|---|---|---|
| TRDD | many files, 4 zone dirs | one FILE = one card | the **filename** (`TRDD-…-<ID8>-slug.md`) | 4 |
| SPEC | 6 files in `design/specs/` (its `proposals/`+`archived/` are **empty**) | one CLAUSE, many per file | the **body** (`3P-KAN-06`; 38 distinct in one file) | 1 live |
| PRRD | **ONE** file, `design/requirements/PRRD.md` | one BULLET LINE = one rule | the **line** (`- **G1.2** — …`) | none |

The plan's `kinds.ts` = *"zones, filename + id grammar"* is TRDD-shaped: it assumes the id comes
from the filename, which is true for exactly one of the three. Contorting PRRD into a "corpus of
one zone with one file" would be the *abstraction over 1.5 consumers* the advisor warned about.

**The generalization that actually fits: a corpus is a set of DOCUMENTS; each document yields ≥1
RECORDS.** TRDD is the 1:1 case; SPEC and PRRD are 1:N. One split covers all three with no
contortion — and it is the same shape F1 and the Phase-4 DAG lint need anyway, since both must scan
SPEC/PRRD *bodies* for citations. Records, not documents, are what the index stores and what the
edges point at.

### Progress

- **Phase 1 DONE** (`8b892d5b`, NPT `7JK3NCV4`) — fail-loud corpus reader + the exit trichotomy
  (`0` clean · `1` findings · `2` could-not-run), with the non-vacuity guard in the TOOL rather than
  only in the test that happens to run it. CLI contract pinned by `tests/unit/pillar-cli-exit-codes.test.ts`.
- **N4 `CTEQX0ZA` MEASURED** (`2ed6f97c`, `2ec2d26e`) — the curve, the memory wall below the target,
  and the reference-join reframe. `scripts/gen-trdd-fixture.mjs` regenerates any corpus size.
- **Phase 2 DONE** (`09db6b8c`) — `lib/pillar/{kinds,store}.ts`; `lib/trdd-store.ts` re-expressed
  with its public API frozen. **Acceptance met: 73/73 across the store, CLI and doctor suites pass
  UNCHANGED.** New `tests/unit/pillar-store.test.ts` (15) covers the per-line half TRDD never
  exercises; both key guards proven by neuter run (unanchor the spec declaration → only the named
  citation test fails; keep the PRRD tier letter → the named test AND the bare-number `findRecord`
  fail). Full suite 254 files / 3809 passed / 2 skipped.

- **Phase 5 index BUILT AND PROVEN** — `fff68910` (`freshness.ts`, per-file identity: git consulted
  twice for the whole corpus, zero per-file syscalls when clean) · `3a17a97b` (`index-db.ts`: the
  10-point memgrep contract + the **edges** table F1 requires) · `e4b08f29` (**the janitor#123 guard
  was DECORATIVE** — a neuter run caught it; `since` was per-table where the bug is per-column, and
  `behind`/`damaged` were alternatives where they must be orthogonal) · `f66f4de0` (`index-build.ts`:
  `syncIndex` incremental + `danglingRefs`, schema **v2** so a changed file's FTS rows can be
  evicted) · `1d88fa12` (`corpusKeyFor`: one index per corpus, slug+hash because every corpus is
  called `design`, realpath-resolved so one corpus never gets two indexes).
  **Acceptance met: the differential test passes on the LIVE corpus** — index-backed id set ==
  `loadTrddGraph`'s walked set (>100 ids). A no-change sync reads nothing (`records: 0, edges: 0`).
  Full suite 257 files / 3862 passed / 2 skipped.
  **7 neuter runs**, each failing only its named test, each restored byte-clean — one of which did
  NOT fail on the first attempt, which is exactly how the decorative guard was found.

- **EHT `BQC8NQSW` DONE + archived** (`fc53ce99`, `ce28bd3c`) — the lint at 10⁵ went from an **OOM
  CRASH (exit 134, 4.45 GB)** to a clean run (**exit 0, 2.43 GB, 22.6 s**), measured on a real
  100 000-card fixture rather than extrapolated. Findings over the live corpus are **byte-for-byte
  identical** before and after (307 scanned · 0 errors · 294 warnings), which is what proves the
  refactor changed cost and not verdicts. The doctor also stopped walking the corpus TWICE per
  report — graph nodes now come from the same read via `toGraphNode`.
- **The card's premise was incomplete, and the missed cause dominated: `gray-matter` caches every
  parsed file FOREVER** (module-level, keyed by the file's full text, storing `orig`). So memory
  tracked total corpus bytes no matter what the caller kept — **streaming alone could never have
  fixed it.** Found by probe, and the obvious explanation was WRONG: identical frontmatter cost
  456 MB with 10 KB bodies vs 104 MB with 1 KB bodies, which is the exact signature of V8 sliced
  strings; deep-flattening every string moved it **−3%**, refuting that reading. Retained heap is
  now 35 MB on both fixtures.
- **EHT-adjacent defect found and fixed: `TRDD-X6MJIMYS`** (`d32fc46f`, archived) — the same
  one-argument `matter()` call sat in THREE other subsystems reachable from the long-lived server
  (marketplace scan, plugin builder, the ChangeClient converter chain), where the leak is
  **unbounded**. One owner now (`lib/gray-matter-nocache.ts`) + a **source-level** guard, because a
  behavioural test can only cover the call sites someone remembered. Its first version pinned
  NOTHING — `dir/**/*.ts` matched 71 nested files and **zero top-level** ones, so it was blind to
  one of the three files it protects; the neuter run caught it, the positive control did not.

### NEXT ACTION

**DONE — and half its premise was WRONG, which is the finding.** Task #79 shipped (`f19327f9`):
the GRAPH subcommands (`why`/`unblocks`/`roots`/`show`/`board`) are index-backed, carrying
`8KDIB2LT`'s `--no-index` degradation in the same change with a LAZY native import, exactly as this
directive required. But **"wire the SEARCH at the index" was never achievable**: greptrdd's default
search is a REGEX search, and FTS5 is token matching + bm25 — it cannot evaluate a regex, and its
unicode61 tokenizer splits `TRDD-BQC8NQSW` into whole tokens, so even a literal-only prefilter
misses substrings. Search stays WALK-ONLY **by design**; that is now a documented CONTRACT in
`lib/pillar/index-open.ts`, not an unfilled gap. The ACCEPTANCE CRITERION exposed it, not the code.

**The `~22.6 s at 10⁵` above is the LINTER (`validate`), not a graph query — do not quote one for
the other.** Measured separately on the 10⁵ fixture 2026-07-29: the graph walk (`board --no-index`)
is **8.07 s / 1.02 GB**; the linter is **22.6 s / 2.43 GB**.

**NEXT: the critical path is 3 roots** (`greptrdd why L55IYKL4`), all DECIDED-not-IMPLEMENTED —
`CTEQX0ZA` (the 10⁵ budget; in progress), `Q3GZJI1X` (**HELD FOR THE USER** — its one open box asks
the janitor to change an IND-base contract that every project on this machine loads), and
`LXLK7XGX` — **✅ COMPLETE + archived 2026-07-30** (`1dee73c3` built it, `89810d4b` recorded it).
Phase 4's lint is `lib/pillar/dag.ts` + `scripts/pillars-lint.mjs` + `yarn pillars:lint`, 15 tests,
live run **328 documents (323 trdd · 5 spec), 0 findings**, none of the provenance mentions flagged;
box 1's recording half is now the **`3P-DAG` family at `spec-version: 1.2.0`**, so all 3 boxes are
checked and the completion gate opened.
**EHT `MUYRIKN3` is also ✅ COMPLETE + archived (`89810d4b`, `728ff37c`) — Phase 6's spec half is
DONE.** `spec-version: 1.2.0` now carries BOTH new families:
- **`3P-DAG`** (3 clauses) — the reference DAG: direction, the dependency-field allowlist as the
  edge set, and id-forms (prefix optional / case-insensitive / YAML number), because a checker can
  satisfy the first two perfectly and still be blind.
- **`3P-IDX`** (14 clauses) — the indexer-db safety contract, and **the real gap this pass found**:
  Phase 5's index had shipped completely unspec'd. Written from `lib/pillar/index-db.ts` +
  `index-open.ts`, NOT from the plan's prose. Selection rule, stated in the section preamble: every
  clause pins a MUST whose violation is **SILENT**. It carries the janitor's own #123 defect
  (`-05`, behind-vs-damaged with the stamp as sole discriminator, PLUS per-COLUMN granularity — our
  first guard for it was per-TABLE, i.e. #123's bug one level down) and the retired vacuous FTS
  parity check (`-14`).

The janitor was notified ONCE, for the whole 1.2.0, as a comment on **their own open request**
Emasoft/ai-maestro#85 (`issuecomment-5124165382`) — self-contained, since the branch is unpushed and
they cannot fetch the file. The census consumer nobody had named — `tests/unit/pillar-store.test.ts`,
which asserts the live spec's EXACT clause count — went **38 → 55** across the two commits,
grep-counted independently each time.
Two corrections this produced: **(a)** the plan's stated reason for making this a separate script
("the lint requires scanning SPECS/PRRD bodies") is VOID — the lint must not scan bodies at all; it
stays separate because the doctor's contract is *every TRDD in every zone* while this must also read
the SPEC and PRRD corpora. **(b)** Phase 4's other listed rule, *"a PROJECT TRDD must not cite a
LOCAL one"*, is **NOT implemented** — it needs a second (local) corpus root and is not one of
LXLK7XGX's boxes. Do not read Phase 4 as complete.

**EHT `YN8EQWYP` is ✅ COMPLETE + archived 2026-07-30 (`62d9db33`, `004c12a4`) — 4 of 4.** Box 3
("what does a SECOND writer do?") was hiding a live defect rather than posing a design question:
`openIndex` healed on every fault but `downgrade`, and `migrate` takes the write lock, so a second
process opening a not-yet-migrated index timed out and **deleted the first process's index while it
was still writing it** — the unlink succeeds against an open file, so writer one went on writing into
an unlinked inode and reported success, while the heal ledger recorded "damage" that was only
contention. **janitor#123 one level up.** Fixed with a `busy` fault that is NEVER healed (one
`NEVER_HEALED` set, because "is this healable?" was already being decided in two places and neither
knew about `busy`). Behaviour chosen: **wait (bounded) → re-check → never answer stale; on timeout
answer from the WALK.** `syncIndex` now runs ONE `IMMEDIATE` transaction SPANNING the corpus read, so
SQLite's own write lock IS the build lock — no lockfile, no stale-lock heuristic, OS-released on
crash — and the delta is computed under it, so a second writer re-parses nothing. Its previous
rationale was factually wrong (it feared blocking READERS; WAL writers never block readers). Proven
live on the real 4.3 MB corpus index. **Three of that card's four boxes had a wrong premise**: box 1
already satisfied, box 4's wording unachievable, box 2 naming the janitor-footprint rule for a path
that rule never mentions — the owner is this repo's CLAUDE.md runtime inventory, where the
`kanban-index/` precedent the card cites was itself undocumented. Measure a box before building for it.

**EHT `4VCXRHAY` is ✅ COMPLETE + archived 2026-07-30 (`d04ee6a6`, `916e729b`) — and it had been
finished for a DAY.** All 6 boxes were already `[x]` with empty `npt`/`eht`/`blocked-by`; it was
simply never advanced, and it carried **no `implementation-commits:` field at all**, so the SHAs that
landed it were recorded nowhere — the one field that makes a bug found later traceable to the change
that caused it. Re-verified first-hand against the code (not from the boxes): `ValidateDepth`,
`validate()` keeping the strong name, `validateStructural()`, and `openIndex`'s
`depth = opts.verify ?? 'structural'` all present.

**But closing it surfaced a gap it had argued and not delivered, so that is now `C4YJAUD9`.** Its body
says the depth split is only safe if *"the expensive half must have a real scheduled caller rather
than only an opt-in flag — a check nobody runs is a check that does not exist."* Every non-test caller
of the full pass across `lib/ scripts/ app/ services/ server.mjs` is exactly one: a BENCHMARK
(`scripts/bench-cold-index.mjs`). So `integrity_check` — the only check that sees a genuinely damaged
file — now runs solely at create, at each migration step, and after a heal; an index created once and
never migrated again is never fully checked again. `YN8EQWYP` narrowed it further, since `busy` is
now correctly never healed and so no longer triggers the heal path that incidentally full-checked.
Filed as a SIBLING EHT (depth-1: a derived TRDD may not spawn its own), the same route this flock used
for `7CHUK1AZ`.

**NEXT — the completion gate stays correctly shut. Five children are non-terminal, each read from its
own `column:` rather than inferred:** `Q3GZJI1X` (`dev`, **HELD FOR THE USER**), `8KDIB2LT`
(**`blocked` as of 2026-07-30 — 3/4 boxes closed**; see below), `C069SK9E` (`dev` — **BUILT
2026-07-30** (`2ecf491c`); 3 of 4 boxes closed, box 1 left open on purpose because it closes in
`31LJK1CX`), `31LJK1CX` (`backburner` — the warm graph query misses the budget; the freshness probe
alone is 0.59 s of it, and it is now the SINGLE remaining lever, see below), `C4YJAUD9` (`dev` — **BUILT and verified 2026-07-30**
(`5113591d`); its ONE remaining box is the `3P-IDX` clause, deliberately batched with YN8EQWYP's into
the next spec bump so the janitor is notified once, which is why it is not terminal).

**`8KDIB2LT` delivered boxes 1, 3, 4 (`52e7ea4f`, `15d8f8d7`, `28e60ee9`) and is now `blocked` on
`Q3GZJI1X`.** Its one open box needs `prrdgrep`/`specsgrep` to EXIST, nothing tracks their creation as
its own card, and `Q3GZJI1X` gates Phase 3 — so `blocked-by: [Q3GZJI1X]` is the honest state and
`greptrdd why 8KDIB2LT` now prints that root. Box 1 turned out to be a DECISION, not prose: the script
layer already carried a `1`/`2` contract and it is INVERTED against the pillar CLIs'
(`aimaestro-trdd.sh verify` uses `2` = INVALID, `1` = ERROR). Resolved by measurement — `grep` itself
exits 0/1/2, so the grep-shaped CLIs were already canonical; the wrapper is the unauditable EXTERNAL
boundary, so it is documented as the ONE grandfathered exception rather than renumbered. Box 3's
answer is **repo-local, and why**: they are `*.mjs` while the installer globs `scripts/*.sh`, and
distributing one means shipping the Node-22 wrapper because the index needs native `better-sqlite3`
(caps at Node 25).
**`C4YJAUD9` is BUILT (`5113591d`)** — the expensive verify finally has a caller that runs in normal
operation: a 6-hourly server watchdog (first sweep delayed 60 s off the boot path) plus
`greptrdd index-verify [--repair|--all]`. The decision's SPLIT held up, and two things it had not
foreseen came out of building it: `applyPragmas` is wrong for an observer (it sets
`journal_mode = WAL`, a persistent write — `3P-IDX-07` violated by a route nobody would call
healing), and `fileMustExist: true` is what stops `new Database` from MATERIALIZING an index at any
bad path. The ledger records a TRANSITION rather than a poll, because a 6-hourly sweep over one
unrepaired index would otherwise fill all 50 slots with copies of one event and evict every real
heal — destroying the signal `3P-IDX-09` exists to keep. 6 neuter runs; the warm read path is
UNCHANGED, proven by A/B against HEAD-with-it-stashed on the same 10⁴ fixture (0.58 s vs 0.58 s),
which also showed ~0.5 s of any such reading is `npx tsx` startup — so 4VCXRHAY's 0.37 s and this
0.58 s are different harnesses and must not be quoted against each other.

**`C069SK9E` is BUILT (`2ecf491c`)** — `next` was the last graph question the index could not answer
(it called `readyQueue(designDir)`, a SECOND corpus walk through the doctor): **17.1 s → 1.05 s at
10⁵**, byte-identical over **31 111 ranked rows**. `board`/`roots`/`next` are now bounded
(`--limit`, default 20; `--column`), every truncation names what it dropped, and `--limit 0`
reproduces the pre-change bytes exactly — the bound is a default, not a capability removed. Two of
its four boxes were already met before any code was written, and the one the card *named* (`board`)
turned out to be one of **three** verbs with the identical unbounded defect.

Its differential also found a **real bug in the WRITE GATE**: `lib/trdd-doctor.ts`'s `asList` was
array-only, so a legal bare scalar (`npt: TRDD-X`) was invisible to the linter in **all seven** of
its call sites — the same divergence `refList` was exported to end one layer down, kept longer here
because a rule that cannot see an edge reports no finding about it. Inert on today's corpus
(**0 of 196** live cards use the scalar form) and now pinned from both ends.

**`31LJK1CX` DIAGNOSED and is now `blocked` on a new sibling.** It answered every box — all five
graph verbs sit at 0.98-1.11 s against a < 1 s budget, all paying the same O(N) `syncIndex` probe,
so whatever replaces that probe fixes every one of them at once; the git short-circuit is **dead**
on this corpus (100 000/100 000 `stat:` identities) and the dir-mtime filter is **rejected** on an
APFS measurement (an in-place edit leaves the dir mtime unchanged, which is the modal way a TRDD
changes). It also **refuted** one row of its own decomposition — capping the output moves the clock
by nothing (`board` 1.02-1.06 capped vs 1.06-1.08 uncapped), so *"remainder = computing roots +
rendering 7 782 rows"* credited rendering with a cost it does not have. The probe is the whole
residual, bounded under **~360 ms of non-syscall work** above a **~232 ms** irreducible syscall floor.

**`YHYP5XIZ` is COMPLETE, and with it the < 1 s interactive budget is MET.** It closed the accounting
first, in ONE process — and the accounting is what dissolved the problem rather than solving it. Both
"missing times" were the INSTRUMENT: my probe's node boot read 101 ms against a real CLI floor of
**210 ms** (`greptrdd help` reads nothing and costs that), so comparing pipeline-work to
pipeline-work the residual is **0.6%** (835 vs 829 ms); and `identifyFiles` reads 299-306 ms on the
same clock where a faithful reconstruction of its own body reads 297-304 ms, so the "unattributed
~120 ms" was two other processes being subtracted from each other. Two attributions I had proposed
and refuted were answers to a question that was never real.

**What bought the budget was not a cheaper staleness check.** The layer table showed 43 ms of
`identifyFiles` building a git lookup key and probing two git maps that are EMPTY on a non-git
corpus — a fast path `gitRoot` returning `null` makes unreachable *by design*. One hoist
(`canBeGit = shas.size > 0`): `identifyFiles` 299-306 → **236-241 ms**, and in a stashed-BEFORE A/B
on one warm 10⁵ corpus every graph verb crosses **≥1.00 s → ≤0.98 s** (`roots` 1.02-1.04 → 0.98,
`board` 1.03-1.11 → 0.94-0.97, `next` 1.05-1.08 → 0.97-0.98, `unblocks` 1.00-1.09 → 0.93-0.97,
`why` 1.01-1.07 → 0.95-0.97). The probe still `stat`s every file; the guarantee is untouched, and a
`canBeGit = false` neuter proves the git path is still live (4 named tests fail, including the
file's positive control).

**Best next: the remaining EHTs — `8KDIB2LT` (`blocked`), `C4YJAUD9` and `MUYRIKN3`'s deliberately
batched spec bump.** The performance thread is DONE at 10⁵: the largest item left anywhere in the
warm path is the **210 ms harness floor** (node + `tsx` boot + greptrdd.mjs's own transpile), and it
is deliberately nobody's card — it affects every subcommand, not just the graph verbs, and its fix
is a bundling/resident-process change rather than anything in `lib/pillar/`. `YHYP5XIZ` records the
number so whoever picks it up starts from a measurement.
Also settled: `Q3GZJI1X` does **not** gate the lint — an ambiguous `relevant-rules:` target is still
unambiguously a TRDD → PRRD edge, and that direction is legal under either reading.

Do NOT extend this to the doctor: it must read every document anyway for the ~25 frontmatter fields
its per-card rules use, so the index would replace no walk there while importing the native
dependency. The walk it COULD replace is `loadTrddGraph`'s, and rebuilding a `TrddNode` needs
`derived`/`hasDerivedField`/`derivedKind`, which the schema does not carry — that is `C069SK9E`.

Scope note, still binding: TRDD→TRDD edges (`blocked-by`/`npt`/`eht`/`parent-trdd`/`superseded-by`)
are unambiguous and are ALREADY indexed. Only the **rule** edges (`relevant-rules:`) wait on NPT
`Q3GZJI1X`, since indexing an ambiguous referent would bake the ambiguity into the schema.

### SUPERSEDED — do NOT carry forward

- *"wait for the janitor's issue to land"* — it landed (#96). The poll loop is over.
- *"Do NOT start rewriting `greptrdd.mjs` yet"* — lifted by the same fact.
- My own earlier reading that memgrep's v5→v6 ladder *"was never attempted"* — **wrong**;
  janitor#123 is right (a version skew described as damage). Both indexes on this host verified at
  `user_version = 6` with `atoms.status` present; correction posted to janitor#124.

## The isomorphism the USER identified

| wikimem | 3-pillars |
|---|---|
| notes are LOCAL / PROJECT / USER scoped | `design/` files are LOCAL / PROJECT / USER scoped |
| collaborators sync PROJECT + USER scope | agents on one repo sync PROJECT + USER scoped design files |
| notes `[[link]]` other notes | TRDDs reference TRDDs (`blocked-by`, `npt`, `eht`, `parent-trdd`, `supersedes`) |
| pages have tiers (hub / aspect / component) | the three pillars are a strict layering (below) |
| `memgrep` = recall by SYMPTOM + a SQLite sidecar index | `greptrdd.mjs` = a dependency walker with **no recall and no index** |

## The reference DAG (USER-stated; currently enforced by NOTHING)

References point only **UP** the abstraction stack — concrete may cite abstract, never the reverse:

```
PRRD  ←────  SPECS  ←────  TRDD
  ↑                          │
  └──────────────────────────┘
```

| edge | allowed? |
|---|---|
| TRDD → TRDD | **yes** — dependency (`blocked-by`/`npt`/`eht`) and other technical reasons |
| TRDD → SPECS | **yes** |
| TRDD → PRRD | **yes** (`relevant-rules:`) |
| SPECS → PRRD | **yes** |
| SPECS → TRDD | **NO** |
| PRRD → SPECS | **NO** |
| PRRD → TRDD | **NO** |

All three pillars share the same lifecycle states — **proposal / active / archived** — expressed as
folders under `design/`.

**The live-recompute hazard the USER called out explicitly:** a change to a PRRD **golden or silver**
rule *immediately* alters the required approval authority of **every TRDD that cites that rule** —
its judge/approver changes underneath it, at any time. So a TRDD's `min-approval-requirement:` is a
**derived** value that can go stale the moment a rule is promoted, demoted, or revised. Today it is a
hand-written frontmatter field with nothing recomputing it.

## Verified state of the tooling (measured 2026-07-26, not assumed)

- `scripts/greptrdd.mjs` (11.9 KB) — subcommands `why`, `unblocks`, `roots`, `next`, `show`, `board`.
  It is a **dependency-graph walker**. It has **no recall-by-symptom**, no full-text search, no
  ranking, and no `description`-indexed lookup — i.e. it cannot answer *"is there already a TRDD
  about X?"*, which is memgrep's entire reason to exist.
- **No index anywhere**: no SQLite sidecar, no cache. `design/` holds **295 markdown files**
  (6 specs · 35 proposals · 100 tasks · 136 archived · 18 refused), rescanned per invocation.
- `lib/trdd-doctor.ts` + `scripts/trdd-doctor.mjs` lint zone/column consistency. **Nothing lints the
  reference DAG above** — a SPECS citing a TRDD, or a PRRD citing either, is currently invisible.
- The IND base rule already forbids one cross-scope edge (*"A PROJECT TRDD MUST NOT cite a LOCAL
  one"* — a dangling reference for every other contributor). That is the same class as wikimem's
  scope-leak detector, and it is likewise unenforced here.

## Why this matters beyond tidiness

Every hazard above is the *same family* as the defects this repo has been fighting all session: a
documented invariant that nothing mechanically checks, so it rots silently and reads as healthy.
wikimem already paid for these lessons. Re-deriving them here would be waste.

## Acceptance

**Triaged 2026-08-22 — NOT closable, but far closer than the board shows.** All 18 NPT/EHT
children are terminal (17 `complete` + 1 `completed`, 0 non-terminal, checked against every
child's own `column:`), and boxes 3-5 verify clean. **Exactly one of box 2's five named
solutions has no decision.** A first triage pass called this DONE-ALREADY; it does not survive,
for the reason recorded under box 2.

- [ ] The janitor's wikimem SPECS + issue are read in full before any design work
      *(process box — unverifiable from the tree after the fact. The delivered work is
      recognisably shaped by those specs, but that is inference, not evidence, so the box stays
      honest rather than ticked on a feeling.)*
- [ ] A design decision is recorded per adopted solution (index, recall-by-symptom, DAG lint, scope-leak lint, live-recompute of `min-approval-requirement`) — each either ADOPTED with rationale or REJECTED with rationale
      **4 of 5 decided, by implementation:**
      **index** → ADOPTED (`lib/pillar/index-{db,build,open,verify}.ts`) ·
      **recall-by-symptom** → ADOPTED (`trddgrep query "wikimem"` returns 46 ranked matches,
      run through the PATH binary the caller actually uses) ·
      **DAG lint** → ADOPTED (`scripts/pillars-lint.mjs` + `lib/pillar/dag.ts`) ·
      **live-recompute of `min-approval-requirement`** → ADOPTED — `lib/trdd-watchdog.ts:118`
      `objectiveFloor()`, compared against the declared floor at `:281-283`, driven by
      `trdd-watchdog-scheduler.ts`. *(Recorded because I got this wrong first: an earlier grep
      scoped to `lib/pillar/` + `pillars-lint.mjs` + `trdd-doctor.ts` returned nothing and I was
      about to write "not adopted" into this card. The implementation was one directory outside
      the scope I chose — the wrong-scope false zero, which reads exactly like a finding.)*
      **⛔ `scope-leak lint` → NEITHER ADOPTED NOR REJECTED.** `grep -rln 'scope-leak|PROJECT
      TRDD MUST NOT cite' lib scripts tests` → **0**, and the card contains zero occurrences of
      `ADOPTED`/`REJECTED`. Silence satisfies neither half of this box.
      **And the obvious subsumption argument fails on measurement.** `lib/pillar/dag.ts:35`
      says reference-EXISTENCE is *"`danglingRefs` in `index-build.ts`"* — which would make a
      PROJECT→LOCAL citation a dangling ref and the scope-leak case already covered. But
      `danglingRefs` (`lib/pillar/index-build.ts:269`) has **4 test references and ZERO
      production callers** — positive-controlled against its own file-mate `syncIndex`, which
      does have one (`index-open.ts:28`), so the zero is real and not a bad needle. The function
      that would catch it never runs. **This box therefore needs a real decision, and "already
      covered" is not available as its rationale.**
- [x] The reference-DAG lint exists and FAILS on a seeded violation (proven by mutation, not by reading)
      → `tests/unit/pillar-dag.test.ts:129` — `describe('box 3 — a seeded frontmatter violation
      still FAILS')`, plus `:149` flagging the bare-id form *"so a violation must not hide behind
      the prefix"*. Live corpus: `yarn pillars:lint` → `✓ 508 documents (500 trdd · 8 spec) — the
      reference DAG holds`, and `dag.ts:30-33` states outright that zero findings is the DESIGNED
      outcome here *(SPECS→TRDD is structurally unexpressible)* — **which is exactly why the
      seeded-violation test, not the clean run, is what this box rests on.**
- [x] Whatever replaces/extends `greptrdd.mjs` can answer "is there already a TRDD about X?"
      → `scripts/trddgrep.mjs`, invoked as `trddgrep query <term>` (`/Users/…/.local/bin/trddgrep`
      is on PATH). Ranked, index-backed, exit 0.
- [x] `bash scripts/with-node.sh npx tsc --noEmit` clean; suite green
      → type-check **exit 0, zero output lines**, 2026-08-22. *(The `with-node.sh` wrapper is
      load-bearing: this shell runs Node 26 against an `engines: <26` cap.)*

## Approval log

- 2026-07-26T15:51:58+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
