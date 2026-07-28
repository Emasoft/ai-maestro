---
trdd-id: BQC8NQSW
title: The linter holds the whole corpus in memory and does not survive 100000 documents
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-29T02:05:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: major
effort: medium
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
implementation-commits: [fc53ce99]
external-refs: []
---

# The linter holds the whole corpus in memory and does not survive 100000 documents

## The hole this handles

Adopting the 10⁵ target fixes the *search* path and leaves the *lint* path behind. `loadCorpus`
(`lib/trdd-doctor.ts:131-154`) returns `Card[]` where every card carries

```ts
raw: fs.readFileSync(file, 'utf8'),
```

plus the parsed frontmatter and body. At 298 files / 3.0 MB that is free. At 10⁵ × ~10 KB it is the
**entire corpus resident simultaneously** — roughly 1 GB before counting parse overhead, and more
than that once `body` and `raw` both exist per card.

Several of the 19 rules genuinely need cross-card state (`ID-DUPLICATE`, the blocked-by/npt edge
checks, zone consistency), so this is not a pure streaming problem — it is a question of what must
be held versus what can be reduced per file.

## Why it is an EHT and not just an optimisation

The parent's premise is that the pillar system works at 10⁵. Shipping an index-backed *search* while
`yarn trdd:doctor` OOMs at the same scale would leave the board unlintable at exactly the size where
lint matters most — and the linter is the thing that keeps the corpus honest. The parent cannot be
`complete` while its own gate cannot run.

## Shape of the fix

- Separate the rules into **per-card** (evaluable from one file, reduced immediately) and
  **whole-corpus** (need an accumulator — keep only the accumulator, never the cards).
- Drop `raw` from the hot path; it exists for the auto-fixer, which can re-read the one file it is
  about to repair.
- Where the index exists, source the whole-corpus rules from it instead of from a walk.

## RESOLVED 2026-07-29 — and the premise above was incomplete

**`commit fc53ce99`.** Measured end-to-end on a real 100 000-card fixture, not extrapolated:

| | exit | peak RSS | wall |
|---|---|---|---|
| before | **134 — OOM crash** | 4.45 GB | died at 23.0 s |
| after | 0 | **2.43 GB** | 22.6 s |

At 20 000 cards: 1 363 MB → 590 MB, 5.85 s → 4.06 s.

**The card named one cause; there were two, and the second one dominated.**

1. **The linter retained every card** (`raw` AND `body`) to serve exactly two rules that read
   prose — STALE-COLUMN's STATE block and the auto-fixer's H1 lift. Both now reduce to a few
   bytes at parse time (`stateReadsDone: boolean`, `h1: string`); the auto-fixer re-reads the ONE
   file it repairs, treating ENOENT as benign (a concurrent `git mv`) and any other errno as a
   fault. The graph nodes are built from the same single read, so the doctor no longer walks the
   whole corpus TWICE per report.

2. **`gray-matter` was caching every file forever, one level below this card's premise.**
   `matter()` keeps a module-level cache keyed by the full file text
   (`matter.cache[file.content] = file`, 4.0.3 `index.js:35-47`) storing the parsed file including
   `orig`. Memory therefore tracked TOTAL CORPUS BYTES regardless of what the caller kept — so
   **the fix this card prescribed could not have worked on its own**: a perfect streaming reader
   that retains NOTHING still accumulates the corpus through that cache. Fixed at the seam
   (`lib/pillar/store.ts::readDocument`), which is where every pillar consumer benefits.

**Found by measurement, and the obvious explanation was wrong.** Retaining only the frontmatter
cost 456 MB with 10 KB bodies vs 104 MB with 1 KB bodies — *identical* frontmatter, 4.4× the
memory. That is the exact signature of V8 sliced strings (a substring ≥ 13 chars keeps a pointer
to its parent, so one retained field pins a whole document), so I deep-flattened every frontmatter
string and re-measured: **−3%. Refuted.** After the cache fix the retained heap is 35 MB on BOTH
fixtures — the body-size coupling is gone.

### Deviation from "Shape of the fix", recorded rather than skipped

- **"keep only the accumulator, never the cards"** — the reduced cards ARE kept (~2 KB each vs
  ~70 KB). Evaluating every rule inside the stream and keeping only findings would move each
  cross-card finding (ID-DUPLICATE, ORDER-NPT-VIOLATED, DERIVED-FLAG-MISSING, DANGLING-REF) out of
  its card's position into a trailing block, because those cannot be answered until the last card
  is read — and this card's own acceptance demands identical findings **including order**. The
  reduction is what the budget needed; reordering the report to save the last 2 KB would trade a
  provable property for an unmeasured one.
- **"where the index exists, source the whole-corpus rules from it"** — NOT done, deliberately.
  The doctor must read every document anyway (the index stores id/column/title/edges, not the ~25
  frontmatter fields the per-card rules read), so the index would replace no walk here while
  adding `better-sqlite3` — native, capped at Node 25 — to `greptrdd`'s import graph, which is the
  regression EHT `8KDIB2LT` exists to prevent. The walk the index COULD replace is
  `loadTrddGraph`'s, and reproducing a `TrddNode` needs `derived`/`hasDerivedField`/`derivedKind`,
  which the schema does not carry — that is EHT `C069SK9E`'s scope. The second walk is gone
  anyway, by sharing the first read.

### Blocker cleared

`blocked-by: [CTEQX0ZA]` gated *"state the 10⁵ budget before designing the fix"*, and that budget
is measured and recorded (< 4 GB RSS, hard). CTEQX0ZA's three remaining boxes are about the
INDEX's degradation policy, which this card does not depend on — so the edge is cleared here
rather than left to misreport finished work as blocked.

## Acceptance

- [x] Peak RSS for a full lint over the 10⁵ fixture corpus is inside the CTEQX0ZA budget —
      **2.43 GB < 4 GB hard**, measured on 100 000 real generated cards
- [x] Findings over the live corpus are **identical** before and after — byte-for-byte on the full
      dump (rule, id, severity, autofixable, path, message, order): 307 scanned, 0 errors,
      294 warnings, both runs
- [x] `report.scanned` still counts every file — 307 live, 100 000 on the fixture
- [x] No rule silently drops a card it used to evaluate — proven by the identical-findings check,
      not by reading
- [x] The new guard is neuter-verified: restoring `matter(raw)` fails exactly the two named cache
      tests (2 failed / 16 passed), while the positive control — asserting gray-matter DOES cache
      when called the ordinary way — still passes, so the test cannot pass merely because some
      future gray-matter has no cache

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
