---
trdd-id: 216FTVC9
title: Nothing checks whether a cited TRDD target exists — danglingRefs has tests and zero production callers
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T02:33:20+0200
updated: 2026-08-22T02:33:20+0200
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

- [ ] The live dangling-reference count is measured and recorded here BEFORE the exit-code
      decision is made — the number decides fail-vs-advisory, not a preference.
- [ ] `danglingRefs` has at least one production caller, and `grep -rn danglingRefs` outside its
      own file and its test returns a non-zero count.
- [ ] A seeded dangling reference is FLAGGED — proven by mutation via `scripts/dev/neuter`, not by
      reading. (The existing test proves the function works; this proves the WIRING does.)
- [ ] The exit-code contract is stated wherever the lint is documented, and follows the repo's
      trichotomy: `0` clean · `1` findings · `2` could not run.
- [ ] `TRDD-L55IYKL4` box 2's scope-leak item is revisited, since this card is what makes its
      "already subsumed" rationale available or not.
- [ ] `bash scripts/with-node.sh npx tsc --noEmit` clean; suite green.

## Estimated risk

LOW. The function exists and is tested; this adds a call site. The only real hazard is the
exit-code choice — a lint that reddens against a large pre-existing corpus on its first run is
worse than no lint, because it teaches everyone to ignore it.

## Approval log

- 2026-08-22T02:33:20+0200 — MANDATE (self, Tier-0): in-repo tooling fix on our own tree,
  reversible, no cross-repo or governance surface. Found while verifying `TRDD-L55IYKL4` box 2
  during the 2026-08-22 board triage — the "already covered" rationale was checked rather than
  assumed, and did not survive.
