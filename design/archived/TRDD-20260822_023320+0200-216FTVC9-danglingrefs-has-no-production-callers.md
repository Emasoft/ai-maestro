---
trdd-id: 216FTVC9
title: Nothing checks whether a cited TRDD target exists — danglingRefs has tests and zero production callers
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T02:33:20+0200
updated: 2026-08-22T03:10:55+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-22T02:33:20+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: S
labels: [pillars, lint, dead-code, reference-integrity]
external-refs: [TRDD-L55IYKL4]
---

# Nothing checks whether a cited TRDD target exists

## Problem

`lib/pillar/dag.ts:35` states the division of labour plainly:

> `NOT THIS LINT'S JOB: whether a cited target EXISTS. That is danglingRefs in index-build.ts.`

That is a correct and deliberate design: the DAG lint checks edge **direction**, and reference
**existence** belongs elsewhere. The problem is that the elsewhere never runs.

`danglingRefs` (`lib/pillar/index-build.ts:269`) has **zero production callers**. Measured
2026-08-22:

```
grep -rn 'danglingRefs' lib scripts services app tests   →  4 hits, ALL in
                                                            tests/unit/pillar-index-build.test.ts
positive control — syncIndex, same file:                 →  lib/pillar/index-open.ts:28
```

The control matters: `syncIndex` is exported from the same module and **does** have a production
caller, so the zero for `danglingRefs` is a real absence and not a bad needle.

So the pillar system has a well-tested function for the one check nobody performs, and a comment
in a second file confidently delegating to it. Every instrument reports healthy.

## Why this is worth a card rather than a shrug

**A dangling reference fails toward "fine".** `yarn pillars:lint` currently prints
`✓ 508 documents (500 trdd · 8 spec) — the reference DAG holds`, which is TRUE and is about edge
direction only. A card citing a `blocked-by:` target that does not exist produces no finding
anywhere — it simply looks like a card with a blocker, forever.

This is the same shape as the defects the pillar work was built to kill, arriving one layer down:
*a documented invariant that nothing mechanically checks, so it rots silently and reads as
healthy* — `TRDD-L55IYKL4`'s own words for why the wikimem solutions were worth adopting.

It also has a concrete, already-measured consequence. `L55IYKL4`'s box 2 asks for an ADOPT or
REJECT decision on a **scope-leak lint** (the IND rule forbids a PROJECT TRDD citing a LOCAL
one). The obvious rejection rationale — *"already subsumed by `danglingRefs`, since a LOCAL card
is not in this tree and would therefore be dangling"* — **is unavailable precisely because of
this card.** Fixing this one makes that rationale true and lets the other card close.

## Proposed fix

Wire the existing function; do not write a second one. `danglingRefs` is tested
(`tests/unit/pillar-index-build.test.ts:178` — *"danglingRefs — the query the index exists for"*),
so the work is a call site plus a report line, not an implementation.

Open question the implementer must settle FIRST, because it decides where the call goes:
**does a dangling reference make `pillars-lint` exit 1, or is it advisory?** The corpus has 500
TRDDs and an unknown number of existing dangling refs; a lint that reddens on day one against a
large pre-existing set gets routed around rather than fixed. **Measure the live count before
choosing.** If it is small, fail. If it is large, report-only with a stated ratchet.

## Acceptance

- [x] The live dangling-reference count is measured and recorded here BEFORE the exit-code
      decision is made — the number decides fail-vs-advisory, not a preference.
      **MEASURED 2026-08-22T02:3x — the corpus is CLEAN: 0 dangling across 252 reference edges /
      140 distinct targets over 501 cards.** Fields swept: `blocked-by`, `npt`, `eht`,
      `parent-trdd`, `superseded-by` (`relevant-rules` correctly excluded — it cites PRRD numbers,
      not TRDDs).
      **Instrument proven in BOTH directions before the zero was believed**, because a zero is
      otherwise indistinguishable from a broken needle:
      - *negative control* — a seeded fake target `ZZZZ9999` **is** flagged, so the comparison can
        detect a dangling ref;
      - *coverage control* — **all 501 `trdd-id:` values are exactly 8 characters**
        (`awk 'length!=8'` → 0), so the 8-char token filter in the extractor loses nothing. This
        was the real risk: several cards have UUID-style FILENAMES
        (`TRDD-d46b42e9-52fa-4f04-…`), and had their `trdd-id:` been the full UUID, every
        reference to the short form would have read as dangling. It is not; they carry 8-char ids.
      **⇒ THE EXIT-CODE DECISION IS SETTLED: fail on findings (exit 1).** The card reserved this
      for the measurement precisely because a lint that reddens against a large pre-existing
      backlog gets routed around rather than fixed. There is no backlog, so a failing lint can
      only ever redden on NEW breakage — the case where failing is right.
- [x] `danglingRefs` has at least one production caller, and `grep -rn danglingRefs` outside its
      own file and its test returns a non-zero count.
      → `lib/pillar/index-open.ts` exports `danglingTrddRefs(designDir)` (a SIBLING of
      `loadTrddGraphViaIndex`, identical open/sync/close, different query), called from
      `scripts/pillars-lint.mjs`. Commit `20d0bbfa`.
- [x] A seeded dangling reference is FLAGGED — proven by mutation via `scripts/dev/neuter`, not by
      reading. (The existing test proves the function works; this proves the WIRING does.)
      → **Proven twice, at two altitudes.** (a) CLI, on a scratch corpus so no real card was
      touched: clean fixture → **exit 0** *"the reference DAG holds, and every citation
      resolves"*; same fixture with `blocked-by` repointed at a nonexistent id → **exit 1**,
      `ERROR DANGLING-REF`, naming source card, field and unresolvable target.
      (b) **NEUTER, and this is the one that mattered.** Before the test existed,
      `s|return danglingRefs(db, TRDD_KIND.name)|return []|` reddened **0 of 49** across the
      three pillar suites — the call site I had just added was unpinned, so the next edit
      would remove it silently. That is the same defect the wiring fixes, one layer up.
      With `tests/unit/pillar-index-open.test.ts` (`b6ae9693`) the identical mutation reddens
      **2 of 4** — exactly the two seeded assertions, while the clean-corpus and containment
      tests correctly stay green.
- [x] The exit-code contract is stated wherever the lint is documented, and follows the repo's
      trichotomy: `0` clean · `1` findings · `2` could not run.
      → Stated at the call site in `pillars-lint.mjs`. The throw from `danglingTrddRefs` is
      deliberately NOT caught: the file's existing `uncaughtException` handler maps it to
      **exit 2**. Catching it would print *"the reference DAG holds"* over a check that never
      executed — the exact shape of defect this card exists to remove.
- [x] `TRDD-L55IYKL4` box 2's scope-leak item is revisited, since this card is what makes its
      "already subsumed" rationale available or not.
      → **Revisited and DECIDED: REJECTED as subsumed** (`29df5532`), and `L55IYKL4` closed with
      it — all 5 of its boxes ticked, all 18 flock members terminal. The rationale is exact
      rather than approximate: a LOCAL card is outside this corpus by construction and ids
      cannot collide (mint-time uniqueness scans every scope root), so PROJECT→LOCAL citations
      are a **strict subset** of dangling references. Measured population: 15 LOCAL TRDDs across
      7 LOCAL design trees. The one thing subsumption does not buy is recorded on that card —
      the finding reads *"resolves to no TRDD"*, not *"cites a LOCAL card"*.
- [x] `bash scripts/with-node.sh npx tsc --noEmit` clean; suite green.
      → tsc **exit 0**; `pillar-index-open` 4/4, and `pillar-lint` + `pillar-index-build` +
      `pillar-graph-cli` 49/49 unchanged.

## Estimated risk

LOW. The function exists and is tested; this adds a call site. The only real hazard is the
exit-code choice — a lint that reddens against a large pre-existing corpus on its first run is
worse than no lint, because it teaches everyone to ignore it.

## Approval log

- 2026-08-22T02:33:20+0200 — MANDATE (self, Tier-0): in-repo tooling fix on our own tree,
  reversible, no cross-repo or governance surface. Found while verifying `TRDD-L55IYKL4` box 2
  during the 2026-08-22 board triage — the "already covered" rationale was checked rather than
  assumed, and did not survive.
- 2026-08-22T03:10:55+0200 — COMPLETED by ai-maestro-hub (min-approval-requirement: none). All 6 boxes ticked.
  The wiring landed (`20d0bbfa`), is pinned by a neuter that went from **0 red / 49 green** to
  **2 red / 4** once `tests/unit/pillar-index-open.test.ts` existed (`b6ae9693`), and unblocked
  `L55IYKL4`'s last decision (`29df5532`). Filed and closed the same night, which is the point:
  the defect was found by CHECKING a rationale instead of accepting it.
