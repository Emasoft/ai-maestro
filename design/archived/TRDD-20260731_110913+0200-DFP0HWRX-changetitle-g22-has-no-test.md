---
trdd-id: DFP0HWRX
title: ChangeTitle G22 has no test — the guard that exists because a false success shipped is unpinned
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-07-31T11:09:13+0200
updated: 2026-07-31T11:25:22+0200
created-by: claude-ai-maestro
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-ai-maestro
approval-datetime: 2026-07-31T11:09:13+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 2
severity: medium
effort: medium
release-via: none
relevant-rules: [R51, R9.13]
labels: [test-coverage, change-title, governance-guard, found-by-retrofit]
external-refs: [4ee79582, 2baaf945]
implementation-commits: [8ca58c05]
---

# ChangeTitle G22 has no test — the guard that exists because a false success shipped is unpinned

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-31

**State: DONE** (commit `8ca58c05`). Four tests in `tests/services/change-title-window.test.ts`,
five recorded neuters, each reddening itself and only itself. Suite **310/4437/2 → 310/4441/2**;
`tsc` 0 lines. Zero production-code change — the gate was always correct, nothing verified it.

**NEXT ACTION:** none, this card is terminal. The neighbouring work is `TRDD-DQ6XN2VP` commit 3,
now safer to build: it routes G22 to the runner's `invariants` hook, and
rollback-on-invariant-violation lands on a gate whose abort conditions are pinned.

**Load-bearing facts — these are what a future reader needs, and none is obvious:**
- The gate is `ChangeTitle`'s **G22**, the last gate of the transaction array in
  `services/element-management-service.ts` (`id: 'G22'`).
- **THE INJECTION POINT IS A MEASUREMENT, NOT A CHOICE.** G14 checks its own write TWICE — the
  RETURN VALUE of `updateAgent` for memory, then a fresh `readFileSync` for disk — so a perturbation
  applied inside `updateAgent` reds **G14**, never G22, and the test would silently pin the wrong
  gate. The anchor is **G14e** (`revokeTokensFromIssuer`), the last mocked collaborator that runs
  after G14 completes; between it and G22 there are **ZERO `getAgent` calls**, so corrupting the
  cache cannot derail an intermediate gate.
- **THE PERTURBATION MUST RE-APPLY AFTER EVERY REGISTRY FLUSH.** G16b calls `updateAgent` again
  (programArgs) after the anchor and mirrors the whole store to disk — a once-applied disk
  corruption is rewritten and G22 then passes, vacuously.
- **`failOn` cannot reach a post-condition gate at all** (it makes a collaborator THROW, aborting
  before G22). That is why the helper gained `world.after`, which fires only on SUCCESS — so the
  hook running is also proof the call it anchors to ran.
- The gap **PRE-DATED** the R51 retrofit (`TRDD-DQ6XN2VP`) — an independent finding that retrofit
  surfaced, not a hole it opened. That is why it was filed as its own card rather than an EHT.

**SUPERSEDED — do NOT carry forward:** "disabling both drift aborts leaves the suite green, zero
red" (measured at `4ee79582`). That WAS true and is now the **N0 neuter's acceptance signal** — the
same mutation today reds both drift tests by name (2 failed | 7 passed).

## Problem

`ChangeTitle`'s G22 verifies that the title write actually persisted — first in the in-memory
registry cache, then by re-reading `~/.aimaestro/agents/registry.json` from disk. Either drift is a
hard abort.

**Nothing tests it.** Neutering both drift checks (`if (false && …)`) leaves the entire suite green.

The gate's own comment records why it exists:

> CRITICAL (SCEN-007 P0-003, SCEN-020 BUG-001, SCEN-002 P0-001): This gate MUST hard-fail if the
> registry write did not persist. Previously this was a silent WARN, which let callers claim success
> while governanceTitle stayed null in `~/.aimaestro/agents/registry.json`.

So this is the sharpest possible instance of a general trap: **the guard that exists BECAUSE a false
success shipped is the one most likely to have no test** — the incident is treated as the evidence,
so nobody writes one. Three separate scenario runs found the bug; the fix landed; the test did not.

## Root cause

Not a code defect. Two process causes:

1. **The incident stood in for the test.** Three scenarios reproduced the symptom, the WARN was
   promoted to a hard abort, and the scenario reports became the record. A scenario run is not a
   regression test — it does not run in `yarn test` and cannot red on a future edit.
2. **Nothing forces a mid-pipeline failure anywhere in `ChangeTitle`.** The card `TRDD-DQ6XN2VP`
   records the same for `DeleteAgent`: *"no test anywhere in the repo forces a mid-pipeline failure
   and asserts the system was left unchanged."* G22 is a post-condition, so it can only be reached
   by making an EARLIER write silently not persist — which no fixture does.

**The neuter to reproduce (and the acceptance signal):**

```
in services/element-management-service.ts, gate id 'G22':
  if (finalTitle !== (effectiveTitle || null))        →  if (false && finalTitle !== …)
  if (diskFinalTitle !== (effectiveTitle || null))    →  if (false && diskFinalTitle !== …)

TODAY:  bash scripts/with-node.sh yarn test  →  310 files / 4437 passed / 2 skipped, ZERO red
WANTED: at least one NAMED test reds per disabled check
```

## Proposed fix

Add characterization tests in `tests/services/change-title-window.test.ts` (it already drives the
real 1219-line pipeline against a temp home, which is the seam this needs — do NOT build a new one):

1. **In-memory drift aborts.** Make the registry cache report a title different from the one written
   (stub `getAgent` to return a stale `governanceTitle` after the write), assert
   `result.success === false` AND `result.error` matches `/G22: Final in-memory title drift/`,
   naming both the shown and expected titles.
2. **On-disk drift aborts.** Leave the cache correct and make `registry.json` on disk hold the OLD
   title, assert the error matches `/G22: Final on-disk title drift/`. **This is the case the three
   scenarios actually hit** and the reason the disk re-read exists — the cache agreed and the file
   did not.
3. **Verification-failure aborts.** Make the disk read throw (unreadable / non-array JSON — an
   `ENOTDIR`/`EISDIR` shape, never `chmod`, which passes vacuously as root) and assert
   `/G22: Final verification failed/`. This is the arm whose `try` was deliberately narrowed during
   the retrofit; it is currently the only one with a plausible existing path.
4. **Positive control.** A clean title change reaches G22 and emits
   `G22: Final title verified in cache + registry.json`. Without it, tests 1-3 pass on a pipeline
   that never reaches G22 at all.

**The try-narrowing is a distinct property and needs its own assertion.** During the retrofit G22's
on-disk drift check was moved OUT of the `try` that guards the disk read, because as a `throw` it
would otherwise be swallowed by that `catch` and re-reported under the generic "Final verification
failed" — losing the specific message. Test 2 must assert the SPECIFIC string, or the narrowing
regresses silently.

## Verification

- Each of the four tests neutered individually reds itself and only itself.
- The reproduction neuter above (both drift checks disabled) reds tests 1 and 2 by NAME.
- Full suite green with all four added; report the new baseline counts, since every ChangeTitle
  slice verifies against the exact numbers.

## Estimated risk

**LOW.** Tests only — no production code changes. The one real risk is a VACUOUS test: G22 is a
post-condition, so a fixture that fails earlier in the pipeline never reaches it and every assertion
passes for the wrong reason. The positive control (test 4) is what makes the other three meaningful
and is not optional.

**Dependencies:** none. Explicitly NOT blocked on `TRDD-DQ6XN2VP` commit 3 — G22 is in the gate
array today and reachable from the existing test seam. Doing this FIRST is strictly better: commit 3
routes G22 to the runner's `invariants` hook, and a rollback-on-invariant-violation is far safer to
build on a gate whose abort conditions are already pinned.

## Approval log

- 2026-07-31T11:09:13+0200 — MANDATE issued by self (min-approval-requirement: none).
  Pre-approved: Tier 0, in-scope test coverage for this project's own code, no governance change, no
  baseline deviation, reversible and local. No approval request was sent.
- 2026-07-31T11:25:22+0200 — COMPLETED by self. Four tests + five neuters landed at `8ca58c05`;
  every checklist box is `[x]` and `npt:`/`eht:` are empty, so the completion gate is satisfied.
  Zero production-code change — the finding was a coverage gap, not a defect.

## Checklist

- [x] Test 1 — in-memory drift aborts with the specific `/G22: Final in-memory title drift/` message
- [x] Test 2 — on-disk drift aborts with the specific `/G22: Final on-disk title drift/` message (the scenario-reported case; also pins the try-narrowing)
- [x] Test 3 — an unreadable/non-array registry aborts with `/G22: Final verification failed/` (a non-array object; `.find` throws inside the try, exactly the case the gate's comment names)
- [x] Test 4 — positive control: a clean change reaches G22 and emits its verified op
- [x] Neuter run recorded: both drift checks disabled → tests 1 and 2 red BY NAME (**2 failed | 7 passed**; the positive control and the verification-failure test stayed green, which is correct — neither depends on a drift check)
- [x] Per-test neuters recorded: each test reds itself and only itself — N1 in-memory check → in-memory test; N2 on-disk check → on-disk test; N3 the catch's `throw` → verification-failure test; N4 the success op → positive control. Source restored byte-identical (sha match + `diff -q` clean + clean `git status`).
- [x] Full suite green; the new baseline counts reported — **310 files / 4441 passed / 2 skipped** (baseline + 4), `tsc` 0 lines
