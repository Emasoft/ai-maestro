---
trdd-id: YHYP5XIZ
title: Make the warm-query stage timings SUM before optimising any of them
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-30T03:21:55+0200
updated: 2026-07-30T03:21:55+0200
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

## Acceptance

- [ ] ONE in-process instrumented run on a 10⁵ fixture where the stage parts SUM to that same run's
      end-to-end, with the residual named and < 5% of the total. State the fixture, the Node
      wrapper, and n.
- [ ] The ~120 ms above the raw-stat loop shape inside `identifyFiles` is either ATTRIBUTED to a
      named call or recorded as noise with the evidence that shows it. No third guess.
- [ ] A paydown decision that follows from the accounting — implemented if the accounting names a
      reachable win, or recorded as "not worth paying" with the numbers that say so.
- [ ] If anything shipped: all five graph verbs still byte-identical index-vs-walk (the existing
      differential, unchanged), and a re-measured 10⁵ number against the < 1 s budget.
- [ ] The staleness guarantee is intact — no heuristic, no skipped probe, `3P-IDX-07` green.

## Approval log

- 2026-07-30T03:21:55+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: a Tier-0 self-mandate, sibling EHT of `L55IYKL4`. No approval request was sent.
