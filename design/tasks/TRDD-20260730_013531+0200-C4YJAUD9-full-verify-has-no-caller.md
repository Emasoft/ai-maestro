---
trdd-id: C4YJAUD9
title: The index's expensive verify has an entry point and no caller, so corruption is detectable and undetected
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-30T01:35:31+0200
updated: 2026-07-30T01:35:31+0200
implementation-commits: []
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T01:35:31+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 2
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The index's expensive verify has an entry point and no caller, so corruption is detectable and undetected

## The hole this handles

`TRDD-4VCXRHAY` split `validate` by depth because running the full pass on every open made the
SAFETY MECHANISM the scaling wall: a graph query over 10 000 cards cost 11 ms behind a 666 ms open,
of which 671 ms were two whole-index scans. The split was correct and is measured — warm `board` went
**1.03 s → 0.37 s**. Its own body then stated the condition the split depends on:

> the expensive half must have a real scheduled caller rather than only an opt-in flag — **a check
> nobody runs is a check that does not exist.**

**That caller was never built.** Measured 2026-07-30 while closing 4VCXRHAY, by grepping every
non-test caller of the full pass across `lib/ scripts/ app/ services/ server.mjs`:

| caller | what it is |
|---|---|
| `scripts/bench-cold-index.mjs:66` | a BENCHMARK. Not scheduled, not on-demand, not run in normal use |

That is the entire list. `validate()` and `openIndex(file, { verify: 'full' })` exist and are
exercised only by tests. So 4VCXRHAY's box 3 ("an explicit full-verify entry point exists") is met
exactly as worded, and the principle the same card argued is not.

**What is actually unchecked.** The full pass adds SQLite's `integrity_check`, which walks every
b-tree page — the one check that detects a genuinely damaged file rather than a wrong shape. It now
runs ONLY at create, at each migration step, and after a heal. An index that is created once and
never migrates again therefore never gets a full check for the rest of its life. `TRDD-YN8EQWYP`
narrowed this further: the read path is `structural` by design, and `busy` is now (correctly) never
healed, so contention no longer triggers the heal path that would have incidentally full-checked.

Corruption is not silent forever — SQLite raises on damaged pages at query time and `openIndex`
treats a throw as a heal trigger — but that is detection by ACCIDENT, at the moment a user is asking
a question, rather than by a verifier whose job it is.

## What has to be decided

The work is small; the decision is where it lives. Three candidates, none obviously right:

1. **A `greptrdd` subcommand** (`greptrdd index-verify`, or a `--verify` flag on an existing one) —
   on-demand only, zero scheduling machinery, and it gives a human something to run. Cheapest. But
   on-demand means nobody runs it, which is the failure this card is about.
2. **A server timer**, alongside the absorbed janitor chores (`TRDD-KCRMSNL7`'s per-chore unref'd
   timers). Real scheduling. But the server is not the index's only writer — every agent's
   `greptrdd` is — so a server-scheduled verify covers a path the server does not own, and it must
   iterate `statePath('pillar-index')/*.sqlite`, i.e. N corpora it may know nothing about.
3. **Sampled on the read path** — full-verify with probability 1/N per open, so cost amortizes and
   every index gets checked eventually. Needs no scheduler and covers exactly the writers that
   exist. But it reintroduces a rare multi-second open, which is the thing 4VCXRHAY removed.

Whatever is chosen must NOT reintroduce the wall 4VCXRHAY measured, and must record a heal event
when it finds something (`recordHeal`) so a recurring corruption is visible rather than repaired in
silence.

## Acceptance

- [ ] A caller of the FULL pass exists that runs in normal operation — not a benchmark, not a test,
      not an opt-in flag a human must remember
- [ ] The chosen home is recorded here with the reason the other two were rejected
- [ ] MEASURED: the warm read path is unchanged from 4VCXRHAY's 0.37 s at 10 000 cards — the
      verifier must not put the wall back
- [ ] A fault it finds is recorded in the heal ledger, so a corruption that recurs is visible
      (`3P-IDX-09`); NEUTER-proven, by seeding a corrupt index and asserting the ledger grows
- [ ] `3P-IDX` gains the clause that the expensive pass must have a real caller, batched with the
      next spec bump rather than triggering one of its own (see the note on YN8EQWYP)

## Approval log

- 2026-07-30T01:35:31+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier 0: a derived EHT inside the parent's own scope, reversible, no baseline deviation.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
