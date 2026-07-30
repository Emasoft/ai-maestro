---
trdd-id: 31LJK1CX
title: The warm graph query misses the sub-second budget and the freshness probe is why
column: backburner
scope: project
project-id: ai-maestro
created: 2026-07-29T20:26:44+0200
updated: 2026-07-30T03:18:00+0200
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
blocked-by: []
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

## Acceptance

- [ ] The warm-query cost is decomposed against a corpus that is NOT in a git repo, since that is
      the case a git-based short-circuit cannot serve
- [ ] A staleness check is chosen with its failure mode stated explicitly — what input makes it say
      FRESH when the corpus moved, and why that is acceptable or impossible
- [ ] The differential test still passes: index-backed and walk-backed answers agree on the live
      corpus, ORDER included
- [ ] Warm query re-measured at 10⁵ and the verdict re-stated — MET, or MISSED with the residual
      named

## Approval log

- 2026-07-29T20:26:44+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT of TRDD-L55IYKL4, inside this agent's own scope, reversible and local.
