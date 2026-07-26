---
trdd-id: H4Y9F25J
title: Pin every enforced governance rule with a drift-failing test
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T04:48:14+0200
updated: 2026-07-26T19:48:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-26T04:48:14+0200
relevant-rules: [R51]
blocked-by: []
eht: [L42SKUBW, W8NA7ROZ]
npt: []
implementation-commits: [7bec032e, 2298646a, 59893d08]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

USER mandate (2026-07-26): *"the api implement the full all-in-one design and the governance rules
enforced and tested"*, scoped to **Claude only** — codex/gemini/opencode/kiro stay parked.

**The number that motivates this:** `docs/GOVERNANCE-ENFORCEMENT-MAP.md` records **134 sub-rules
with a real code guard and NO test**. Only **5** have both (R25.2, R28.1, R41.1, R41.4, R41.5). The
ratchet `tests/governance/enforcement-coverage.test.ts` carries this as
`MAX_ENFORCED_WITHOUT_TEST = 134` — a counter that is allowed to go DOWN and never up.

**Why this must precede the TRDD-DQ6XN2VP retrofit, and is not merely nice to have.** That retrofit
rewrites the control flow of all 26 mutating pipelines. Its own acceptance says the SUCCESS path
must not move. With 5 rules pinned, "the success path did not move" is a hope; with the guards
pinned it is a measurement. Refactoring 26 pipelines whose governance behaviour nothing observes is
how a rule silently stops being enforced while every test stays green — and an unenforced rule is,
by R51.9, documentation.

**BATCH 1 LANDED (`7bec032e`) — debt 134 → 117.** 17 of its 22 pinned in
`tests/governance/r17-r11-core-plugin-binding.test.ts`. Two findings worth more than the tests:

- **The map's own citations rot.** R17.17 was cited at `server.mjs:1709-1742` (the guard is at
  `1766-1799`) and R17.20 at `1777-1793` — which is *R17.17's* code, not R17.20's (`1801-1869`).
  Both corrected. A map citing the wrong lines is worse than one citing none: it reads as coverage
  and sends the next reader to code that does something else. **Every batch now verifies the cited
  range before writing against it, and reports corrections rather than editing the map.**
- **R17.17 + R17.20 are deliberately NOT pinned and stay counted as debt.** Their guards are real
  but sit inline in `server.mjs::startServer`, which binds sockets on import — there is no seam to
  call. Counting them is the honest record; extracting a seam (precedent:
  `lib/session-validate-server.mjs`) is the work that clears them, and it is production code, so it
  belongs to a separate TRDD, not to a test batch — **TRDD-L42SKUBW**, registered as this TRDD's
  EHT so "every enforced rule pinned" cannot be declared complete while two remain unobservable.

**The 0-IMPACT trap every remaining batch must carry.** Batch 1 wrote real directories under
`~/agents/` before self-catching it: `lib/ecosystem-constants.ts` resolves `homedir()` via a runtime
`require('os')` INSIDE each function body, and `vi.mock('os', …)` intercepts only STATIC imports. The
fix is a PARTIAL mock of `@/lib/ecosystem-constants` overriding the path FUNCTIONS
(`importOriginal`, spread `...actual`) — never the `os` module.

**BATCH 2 LANDED (`2298646a`) — debt 117 → 101.** 16 of 17 pinned. Three things it settled:

- **Wrong map citations are a PROPERTY of the map, not an accident.** Batch 1 found 2; batch 2 found
  **6 pointing at an entirely different guard** plus 4 off-by-a-few, and recorded 4 second
  enforcement sites the map never listed. Two batches, same finding ⇒ assume every unverified
  citation is suspect until executed.
- **R9.9 is the THIRD rule blocked on one missing `server.mjs` seam** (with R17.17/R17.20). That
  makes TRDD-L42SKUBW structural rather than a tidy-up.
- **An absence-invariant is still pinnable** — run the proof backwards. R9.12 forbids a filter, so
  there is nothing to delete; it is pinned by ADDING the forbidden filter and watching it fail.

**Verification found a real production bug (TRDD-F4UUM8RZ, `62b5e58d`).** The full suite failed
once on an unrelated file; `stopAgentInvariantsWatchdog()` stopped the schedule but not the sweep,
so a stop could be followed by a writer re-creating files — the re-appearing-workdir class. My first
pinning test for it **passed with the fix neutered**, i.e. pinned nothing; caught only by the
neuter check. Worth carrying forward: the neuter check is not a formality for the sub-agents, it is
the whole method, and it catches the orchestrator too.

**BATCH 3 LANDED (`59893d08`) — debt 101 → 88.** All 13 of R6 pinned, 96 tests. Two caveats
recorded rather than glossed, and both became TRDDs: **R6.8 is pinned at LAYER 1 only** (its other
two layers are prompt-level, in the role-plugin repos, with no server surface), and **R6.10 is
pinned at the WEAK contract the code actually has** — any truthy `inReplyToMessageId` unlocks a
reply-only edge, repeatedly, unverified. Writing the stronger test and then editing production to
pass it would have been a governance change smuggled in by a test batch, so it is
**TRDD-VLBVO0ZP** instead. **TRDD-2XV78BND** carries two text-vs-code disagreements where the CODE
is right and the TEXT is stale — the dangerous direction.

**RUNNING TALLY OF MAP DEFECTS (3 batches): 8 citations naming the WRONG guard, 8 imprecise ranges,
6 enforcement sites never recorded at all.** That is the map's steady state, not a run of bad luck —
so a citation is evidence only once someone has executed it.

**PHASES 1 + 2b LANDED 2026-07-26 (debt unchanged at 66 — these were instrument work, not pins).**
Commits `b07cfd78`, `c5173e59`, `17471dd3`, `08bd2800`, `f379b2b7`.

- **The ratchet's own guard check had two silent holes** (`b07cfd78`): it validated only the FIRST
  citation of a multi-guard row (so R6.9's second guard was never checked) and captured a range's
  END without using it (so `foo.ts:10-999999` passed). Both fixed, both mutation-proved.
- **Guards may now cite a gate NAME** — `…:6442-6465 (DeleteAgent::G02)` (`c5173e59`). A label
  travels with the code; a line number does not. 17 rows qualified — only those whose cited range
  contains EXACTLY ONE gate. Gate ids are per-pipeline local and reused (G01 means four different
  things), so the citation MUST be `<Pipeline>::<Gnn>`; a bare `Gnn` is ambiguous four ways.
- **The new gate test had a false-green and shipped one commit later** (`17471dd3`): commenting out
  DeleteAgent's five G02 pushes left it GREEN, because a regex over raw text cannot tell code from a
  comment. Fixed; now proved four ways (bad gate, bad pipeline, gate commented, gate deleted).
  **Deletion alone would have passed — try the mutation a developer actually makes.**
- **Part II is now checked against the code on every test run** (`b07cfd78`):
  `python3 scripts/aio-gate-coverage.py --check`. Until then the script never opened the file it
  feeds, so the table was a hand-copied snapshot of an analysis that could not see it.
- **A rotted prose count was removed, not re-checked**: the header claimed "only 5 rules have both a
  guard and a test" while the true figure was 75. The machine-checked constant beside it
  (`MAX_ENFORCED_WITHOUT_TEST`) never drifted. The doc now states no standalone number.
- **TRDD-W8NA7ROZ** (EHT) records the 15 rows that could NOT be gate-qualified — 5 with no label in
  range, 10 whose citation names no single guard (R18.8/R18.9 cite a 391-line range spanning
  ChangeCLIArgs into ChangeClient with 8 gates in it). Not converted: laundering a too-coarse
  citation into an authoritative-looking one is worse than leaving it visibly coarse.
- **Phase 2b — `tests/helpers/fake-ecosystem-home.ts`** (`f379b2b7`): the 0-IMPACT containment idiom
  was hand-rolled in 8 files; now one definition, adopted by r20 (23 lines → 4). It adds a guarantee
  no copy had — it REFUSES a root that is not under a temp dir — and its own test watches it refuse.
  Remaining 7 sites can adopt it incrementally; it is additive.

NEXT ACTION: **batch 5 — R5 (7 transfer rules), all citing
`app/api/governance/transfers/route.ts` + `[id]/resolve/route.ts`.** Grouped by GUARD FILE, not by
rule id, so one context holds one file's mocking setup. Use the new containment helper from the
start. Then R18 (8), noting 5 of its rows are in W8NA7ROZ's defective-citation list — verify those
citations BEFORE writing against them.

Deferred from Phase 2 as tooling, not pins: `scripts/verify-zero-impact.sh` (2a) and the
`setupFiles` timeout unification (2b tail).

One sub-agent at a time (USER spawn rule), tests only.

## The batch plan

Each batch is one sub-agent, one new file under `tests/governance/`, disjoint rule sets.

| Batch | Rules | Untested sub-rules | Status |
|---|---|---|---|
| 1 | R17 core-plugin + R11 title-plugin binding | 22 | **landed — 17 pinned, 2 no-seam, `7bec032e`** |
| 2 | R9 manager requirement + R3 role hierarchy | 17 | **landed — 16 pinned, 1 no-seam, `2298646a`** |
| 3 | R6 communication graph | 13 | **landed — 13/13 pinned, `59893d08`** |
| 4 | R20 marketplace governance | 23 | pending |
| 5 | R18 client-change continuity + R5 transfers | 15 | pending |
| 6 | the remainder (R1, R4, R7, R8, R10, R39, …) | ~44 | pending |

## The constraints every batch carries, and why each exists

1. **TESTS ONLY — never touch production code.** A guard that looks wrong is REPORTED, not fixed.
   Two reasons: DQ6XN2VP is about to rewrite these same files, and a test author who "fixes" the
   guard to match their reading of the rule has silently changed governance.
2. **Never edit `docs/GOVERNANCE-ENFORCEMENT-MAP.md`.** Batches run against a shared file; the
   orchestrator folds the Test column in once per batch. (Three agents editing one map is a merge
   conflict, not parallelism.)
3. **Never mock the thing under test.** The test calls the REAL exported guard; only genuinely
   external I/O (network, tmux exec) may be faked. A test that mocks the guard proves the mock.
4. **Assert the REFUSAL, not the happy path.** The property is "this guard says no". A test that
   only proves the allowed case still passes after the guard is deleted, which is the exact failure
   mode that produced 134 untested guards in the first place.
5. **0-IMPACT.** No writes to `~/.aimaestro`, `~/agents`, `~/.claude`; no agent created or deleted.

## What "pinned" means here

A sub-rule is pinned when deleting or weakening its guard makes a named test FAIL. Anything less —
a test that exercises the guard without asserting its refusal, or that asserts on a mock — is
recorded as NOT pinned, because it would carry the ratchet number down while leaving the rule as
unobserved as before.

## The three non-test outcomes a batch may report

Each is worth more than a test, and none is fixed by the batch that finds it:

- **no-guard-found** — the map cites a guard that is not there. The map is wrong, or the guard was
  removed. Either way the rule is UNENFORCED and the map is overstating coverage.
- **guard-mismatch** — a guard exists but enforces something other than what the rule says. This is
  the `INVENTED`/`CONTRADICTED` case arriving from the other direction.
- **rule-ambiguous** — the rule cannot be tested as written. That is a defect in the RULE, and it is
  a PRRD/governance proposal, not a test.

## Verification

- Per batch: `bash scripts/with-node.sh npx tsc --noEmit` and the batch's own vitest file, both
  clean. (The Node-22 wrapper is mandatory — a bare `yarn`/`npx` aborts on `engines`.)
- Per batch landing: the orchestrator updates the map's Test column for the pinned rows and lowers
  `MAX_ENFORCED_WITHOUT_TEST` by exactly the number pinned. The ratchet then holds the gain.
- Program end: full suite green; `MAX_ENFORCED_WITHOUT_TEST` at its floor; every remaining row
  explained (BEHAVIOURAL, or an open defect TRDD).

## Acceptance

- [x] Batch 1 — R17 + R11 (22 → 17 pinned; R17.17/R17.20 blocked on a `server.mjs` seam)
- [x] Batch 2 — R9 + R3 (17 → 16 pinned; R9.9 blocked on the same `server.mjs` seam)
- [x] Batch 3 — R6 (13/13 pinned; 2 caveats filed as TRDD-VLBVO0ZP + TRDD-2XV78BND)
- [ ] Batch 4 — R20 (23)
- [ ] Batch 5 — R18 + R5 (15)
- [ ] Batch 6 — the remainder (~44)
- [ ] Map Test column updated for every pinned row
- [ ] `MAX_ENFORCED_WITHOUT_TEST` lowered to match, and the ratchet green
- [ ] Every guard defect found is filed as its own TRDD rather than fixed in passing
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-26T04:48:14+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
