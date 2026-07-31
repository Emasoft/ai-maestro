---
trdd-id: YAGRX7W3
title: Make InstallElement transactional — the last AIO-TXN-10 row, and the one with forbidden compensations
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T20:15:22+0200
updated: 2026-07-31T20:27:34+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-31T20:15:22+0200
relevant-rules: [R51, R20.31, R17]
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body)

`InstallElement` is the **last** pipeline still hand-rolling its gates (`MAX_HANDROLLED = 1`).
Every other one landed under `TRDD-DQ6XN2VP`; this was carved out of that card because it is a
**different problem**, not a ninth of the same.

**⚠ THE DESIGN QUESTION IS ANSWERED — see `## ✅ DECIDED 2026-07-31`.** Decision: **(a) narrow the
window**, opening it after `:912`. Do not re-litigate it; (b)/(c)/(d) are rejected there with
reasons. And it is **FIVE** excluded mutations, not the three the parent card named.

**NEXT ACTION — pick one of the three ways out in `⚠ FOUND WHILE STARTING THE BUILD` FIRST.**
"Open the window after the last unreversible mutation" is not a line split: that mutation
(`emitForClient`) is nested four levels deep, immediately before the `adapter.install` it feeds.
Current preference is **option 3** (resolve `storageDir` in a step before the window, scoped to the
adapter branch) — verify it type-checks against `convertedDir`'s flow before committing.

Then build the window **and the CLOSED-SET TEST together**. That test is the load-bearing half:
`MAX_HANDROLLED = 0` while five mutations sit outside every window is a false "complete" signal,
and a comment is not a guard. Assert the pre-window mutation set EQUALS the enumerated five, and
confirm the scanner sees both mutation forms (direct call and via-helper). **Key it on call SHAPE,
never on line numbers** — this card's own citations drifted +3 within one session.

**DO NOT** wrap the EXE settings write, lower the ratchet to 0, and stop. That moves the
conformance number while leaving the five uncompensatable mutations unguarded — the ratchet would
then read "complete" over exactly the pipeline that isn't.

## Problem

`services/element-management-service.ts:567-1486` (920 lines). Two things make it unlike the eight
single-mutation pipelines retrofitted at `2613c907`:

1. **Other retrofitted pipelines CALL it** — ~~and some of those callers branch on the error~~.
   **MEASURED 2026-07-31, and this worry is NOT borne out.** Six real call sites:
   `element-management-service.ts:1379` (PG05, a recursive self-call), `:10013`, `:10100`,
   `sessions-service.ts:916`, and — structurally the interesting pair —
   **`lib/agent-invariants.ts:133` and `:223`**, i.e. *the watchdog itself calls the very pipeline
   whose `mkdir` "fights the watchdog"*. **All six branch only on `result.success` and treat
   `result.error` as an opaque display string; NONE parses it.** So swapping the error for the
   R51.3 message is safe — those callers just print a longer `detail`.

   The one real coupling is different and cheaper to miss: **`:10100` filters
   `result.operations` for entries prefixed `G05`/`G06`** to build a summary line (with a fallback
   string when empty). That is a coupling to op LABELS, not to the error. `G05`/`G06` here are
   PRE-EXE validations (`agentDir for local scope`, `path traversal`) that sit ABOVE any candidate
   window, so a narrowed window leaves them untouched — but any renaming or re-idding of gates in
   that range silently degrades that caller to its fallback. Check it, do not assume it.
2. **Three of its pre-EXE mutations are ones a compensation is FORBIDDEN or harmful to reverse**
   (table below). This is the real content of the card. The other eight had *latent* undos —
   correct, unreachable, cheap. Here the honest undo for three gates is "there isn't one", and the
   design question is what the pipeline should therefore do.

## MEASURED 2026-07-31 (at `facc65b5`, first-hand via the AST) — and two things the parent card got wrong

Measured with a throwaway AST walk (`ts.createSourceFile` → the `FunctionDeclaration` named
`InstallElement` → visit its `body` for `CallExpression`s), the same technique
`tests/governance/aio-txn-10-runner-coverage.test.ts` uses and for the same reason: a brace-counter
mis-binds this function at **12 lines**, because the signature's parameter type contains `{` so
depth returns to 0 before the body opens — the trap `~/.claude/rules/lessons-verification.md`
already records. *(The helper lived in gitignored `scripts_dev/`; it is not in the repo, so re-derive
it rather than looking for it. The numbers below are what matters.)*

| call | count | lines |
|---|---|---|
| `mkdir` | 2 | 718, 894 |
| `saveJsonSafe` | 7 | 961, 979, 1031, 1074, 1092, 1258, 1453 |
| `execFileAsync` | 4 | 829, 941, 1011, 1100 |
| `convertAndStorePlugin` | 1 | 872 |
| `emitForClient` | 2 | 873, 912 |
| `rm` / `rmSync` / `unlink` | **0** | — |

**CORRECTION 1 — the phantom `rm`.** `TRDD-DQ6XN2VP`'s table reads *"13 — `mkdir` ×2,
`saveJsonSafe` ×7 (5 local, 2 user), `execFileAsync` ×4, `rm` ×1"*. That list sums to **14** while
its own total says 13, and the discrepancy is the `rm`: this pipeline calls **no** `rm`, `rmSync` or
`unlink` anywhere in its 920 lines. The total (13) was right; the itemisation was not. Do not carry
an "InstallElement deletes something" premise forward — it deletes nothing.

**CORRECTION 2 — the `PG03`/`PG07` line cites had already rotted when they were written.** The
parent card cites `PG03 (:1253)` and `PG07 (:1448)`. Measured now: `PG03`'s `withSettingsLock` is at
**1244** and its `saveJsonSafe` at **1258**; `PG07`'s are at **1441** and **1453**. Neither cited
line is either. And `InstallElement` has **not moved** since — every edit in `2613c907` was past
line 5861 — so those numbers were wrong at the moment they were recorded, not displaced later.
Re-resolve before citing.

**THE ORDERING FACT THAT DECIDES WHETHER A WINDOW IS EVEN POSSIBLE — measured, not assumed.**
Every mutation that cannot legally be reversed sits **ABOVE line ~915**, and everything from `:941`
down is ordinary CLI-install + settings-file writes:

```
:718  mkdir(agentDir/.claude)          G07   ── unreversible
:829  claude plugin marketplace add    G11   ── unreversible (SHARED)
:872  convertAndStorePlugin            G12   ── unreversible (R20.31 Explicit)
:873  emitForClient                    G12   ── unreversible (R20.31 Explicit)
:894  mkdir(cwd/.claude)               EXE   ── unreversible (same kind as G07)
:912  emitForClient                    EXE   ── unreversible (same kind as G12)
────────────────────────────────────────────  a clean boundary sits here
:941  execFileAsync (CLI install)      EXE   ── reversible
:961  saveJsonSafe   :979 write-back   EXE   ── reversible
:1011 execFileAsync (CLI uninstall)    EXE   ── reversible
:1031 :1074 :1092 saveJsonSafe         EXE   ── reversible
:1100 execFileAsync                    EXE   ── reversible
:1258 saveJsonSafe                     PG03  ── reversible (and a REPAIR — see below)
:1453 saveJsonSafe                     PG07  ── reversible (and a REPAIR — see below)
```

**FIVE, not three.** The parent card named three forbidden mutations; there are **five**, because
`:894`'s `mkdir` and `:912`'s `emitForClient` are the same two kinds repeated inside EXE. Any answer
that excludes "the three" and forgets these two excludes nothing.

**What the parent card got RIGHT, re-verified here rather than inherited:**

| mutation | why a compensation may not reverse it | verified |
|---|---|---|
| `mkdir(<agentDir>/.claude)` — G07 `:718`, EXE `:894` | `.claude/` is the `claude-dir` row of the agent-invariant registry, so the watchdog *guarantees* it exists. An undo deleting it fights the loop that re-creates it. | `lib/agent-invariants.ts:69` ✓ |
| `claude plugin marketplace add` — G11 `:829` | a SHARED, idempotent registration in the user's Claude config. Deregistering it on rollback breaks every OTHER agent installing from that marketplace. | read at `:829` ✓ |
| `convertAndStorePlugin` + `emitForClient` — G12 `:872-873` (and a second `emitForClient` at `:912`) | writes into `~/agents/custom-plugins/`. **R20.31, verdict Explicit**: *"AI Maestro NEVER DELETES a plugin folder from them … Removing a source folder is explicitly the user's responsibility."* A compensation deleting it violates a rule marked Explicit. | `docs/GOVERNANCE-RULES.md:883` ✓ |

**⚠ MY OWN CORRECTION, RETRACTED 2026-07-31.** This card first said *"the parent card labels the
conversion gate `G13`; the emitted label is `G12` — use the emitted label."* **That was wrong, and
the parent card was right.** `G12` (`:861`, `:863`) is the conversion *decision* (does this client
need one); **`G13` (`:866-884`) is the conversion *mutation***. I read only `:861-873`, saw `G12`,
and corrected a label that did not need correcting — the exact failure this repo records about
second-hand claims, committed while correcting someone else's. The gate is **G13**.

**Also still true:** the two USER-scope writes (`PG03` `:1258`, `PG07` `:1453`) are **REPAIRS, not
creators of a disagreement** — each fires only after a *local* install succeeded and each *turns
OFF* an already-enabled user-scope copy. When either fails, user scope is left exactly as the caller
found it, so R51's "return to exactly the state it was in" is satisfied by doing nothing. The
disagreement they address PRE-DATES the call.

## ✅ DECIDED 2026-07-31 — (a) NARROW THE WINDOW, and the exclusion set must be CLOSED BY A TEST

Advisor-reviewed (Fable 5), every claim re-verified in source before adoption. **The decision is
(a).** The reason is not "the others are expensive" — it is that **leaving the excluded mutations
behind produces no invalid state**, which is what R51 actually forbids
(`lib/gate-transaction.ts:3-6`: *"NEVER LEAVES ONE"*). A watchdog-guaranteed `.claude/`, a shared
marketplace registration, and a converted source dir are each valid with or without the install.
The settings/registry writes from `:941` down are the only state that must AGREE WITH THE VERDICT.
So the boundary at `~:915` is the **semantic** boundary, not a conformance-shaped dodge.

**THE MEASUREMENT THAT SETTLES IT — two of the five cannot abort AT ALL:**

| mutation | can it abort the pipeline? | evidence |
|---|---|---|
| G07 `mkdir` `:718` | **yes** — bare `await`, uncaught → outer catch | `:718` |
| G11 `marketplace add` `:829` | **NO** | `.catch(() => {})` at `:832`, *and* the gate body is wrapped to a `G11: WARN` |
| G13 `convertAndStorePlugin`/`emitForClient` `:872-873` | **NO** | its `catch` swallows to an op line and never rethrows |
| EXE `mkdir` `:894` | **yes** — bare `await`, outside the `try` that opens at `:897` | `:894` |
| EXE `emitForClient` `:912` | **yes** — sets `result.error` and returns | `:912-917` |

A gate that can neither fail nor be reversed contributes **nothing** inside a transaction. Wrapping
G11 and G13 would be theatre — *"wrapping a whole pipeline to look thorough manufactures fake
guarantees"* (`lessons-verification.md`). And G07's `mkdir` is the FIRST mutation, so even though it
can throw there is nothing before it to compensate.

**(d) REJECTED, and it is the real dodge.** An `idempotentEnsure: true` flag is exactly as
assertable-without-proof as `readOnly: true`: it hands every future author a third
legitimate-looking spelling of *"I'll add the undo later"* and weakens the pre-flight check for all
18 other pipelines to serve this one. **(c) rejected** for the same reason in a cheaper disguise.
**(b) rejected**: an undo that throws turns a watchdog-guaranteed directory into a permanent false
R51.5 CRITICAL.

**Q2 — is the converted dir left behind a hole? NO, and the "user must clean up" framing was
wrong.** It is a warm cache the next attempt REUSES (sources are preserved across
uninstall/reinstall cycles by design). The genuine subtlety is different: `convertAndStorePlugin`
**overwrites in place** (R20.26), so a failed install may have *advanced* the cached emission
irreversibly. That is forward-convergence by design — **name it in the boundary comment** rather
than pretend the dir is untouched.

**Q3 — YES, `MAX_HANDROLLED = 0` while five mutations sit outside every window IS a false
"complete" signal, and a comment is not the guard.** The minimum honest guard, and the load-bearing
deliverable of this card:

> **A test that scans the pre-window region and asserts its mutation set EQUALS the enumerated
> five.** A sixth mutation added above the boundary must RED it. A comment alone is a blind spot
> that grows unnoticed.

Plus: the ratchet's claim is renamed from *"transactional"* to **"windowed per the R51 boundary
rule"**, so the number stops overclaiming.

### ⚠ FOUND WHILE STARTING THE BUILD — "open the window after `:915`" IS NOT A LINE SPLIT

The decision above says *open the window after the last unreversible mutation*. Going to write it
shows that mutation is **nested four levels deep, immediately before the install it feeds**:

```
:900  try {
:901    switch (action) {
:902      case 'install': {
:903        if (useClientAdapter) {
:913          if (!storageDir) {
:915            storageDir = await emitForClient(...)   ← LAST UNREVERSIBLE
:928          adapterRes = await adapter.install(...)   ← FIRST REVERSIBLE
```

**You cannot draw a horizontal line between `:915` and `:928`.** The lazy emit is inside the
adapter branch, and it exists precisely to produce the input the install consumes. So the window
cannot simply "start lower". Three ways out, none free — **decide before writing**:

1. **Hoist the lazy emit above the window.** Clean split, but the CLI path never uses `storageDir`,
   so this emits for installs that do not need it — doing forbidden-to-reverse work speculatively,
   which is worse than the problem.
2. **Let the emit sit INSIDE the window**, in the same gate as the install, with an `undo` that
   reverses ONLY the install and a comment stating the emit is forward-convergent and deliberately
   not reversed (R20.26). Honest, and it puts an unreversible mutation inside a window — the exact
   thing the decision set out to avoid, so it must be argued, not slipped in.
3. **Split the branch**: a "resolve `storageDir`" step before the window (may emit), then the
   window covers `adapter.install` onward. Same effect as 1 but scoped to the branch that needs it,
   so nothing speculative happens on the CLI path. **Current preference — verify it type-checks
   against `convertedDir`'s flow before committing to it.**

**⚠ AND THE LINE CITATIONS IN THIS CARD ALREADY DRIFTED +3, in this same session, by my own edit.**
The `G13:` mislabel fix at `:880` added three comment lines, so the two EXE mutations this card
cites as `:894` and `:912` are now **`:897`** and **`:915`**. Nothing else moved. Treat every bare
line number here as a hint and re-resolve it — which is also why the closed-set test must key on
**call shape**, never on line numbers.

**Early-warning property (why the pin is not busywork):** if a future edit makes G13's conversion
*required* — aborting on failure instead of swallowing — the pre-window gains an abortable gate and
the window MUST move up. That test is the signal. **If it never reds, re-check that the scanner
matches both mutation forms** (direct call and via-helper), because a scanner that cannot see a
mutation reports a closed set it never measured.

## The design question this card exists to answer (ANSWERED ABOVE — kept for the reasoning)

R51 says an all-in-one never leaves an invalid state. Three gates here cannot be reversed. Those are
not in conflict yet — they become a conflict only if those gates sit INSIDE the transaction. The
candidate answers, none yet chosen:

- **(a) Narrow the window.** Open the transaction AFTER the three unreversible mutations, so it
  covers only the settings write(s) and the adapter/CLI install. Precedent: `TRDD-DQ6XN2VP` measured
  that a window "starts at the first mutation whose reversal is legal and harmless", and excluded
  ChangeTitle's G03 on exactly that basis. Cost: the ratchet then reports InstallElement
  transactional while three mutations sit outside it — which must be stated in the code, not just
  here, or the next reader reads the ratchet as a stronger claim than it is.
- **(b) Declare them `readOnly: false` with an undo that THROWS**, as `ChangeMCP`'s remove undo now
  does. Honest, and produces an R51.5 CRITICAL on every rollback past them — which for `mkdir` on a
  watchdog-guaranteed directory would be a false alarm, so this is probably wrong for at least G07.
- **(c) Make them genuinely idempotent-and-harmless and declare them `readOnly`.** `mkdir
  {recursive:true}` and `marketplace add` are both already idempotent and both are shared state the
  pipeline does not own. If "changes nothing the caller owns" is the right reading of `readOnly`,
  this is the cheapest correct answer — but it stretches `readOnly`'s stated meaning ("cannot change
  any state"), and stretching it silently is how a pre-flight check stops meaning anything.

Pick one, write down WHY, and name what it does not cover. **Do not average them.**

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines.
- `bash scripts/with-node.sh yarn test` at or above the baseline measured on the day (313 files /
  4528 passed / 2 skipped at `facc65b5`; re-measure, do not quote).
- `bash scripts/with-node.sh yarn trddgrep validate` exit **1** with only the two known
  `BODY-STATE-CLAIM` cards (`7123D51A`, `C7A81642`). Never `validate || …` — exit 2 is
  COULD-NOT-RUN.
- **Every new compensation neutered**, with the named test that reds recorded. A compensation that
  is unreachable is *named* as latent, never counted as coverage.
- The callers enumerated in Problem §1 re-checked against their new error shape.

## Estimated risk

**MED-HIGH.** Not for the size — for the blast radius: this pipeline is called by retrofitted
pipelines, so a changed failure shape propagates. The three forbidden compensations make a
mechanical "wrap it like the others" pass actively wrong.

## Acceptance

- [x] The design question **ANSWERED** — (a) narrow the window, advisor-reviewed, every claim
      re-verified in source. `## ✅ DECIDED 2026-07-31` records the choice, the abort-capability
      measurement that settles it, and why (b)/(c)/(d) are rejected
- [ ] The choice + its uncovered surface written into the **code comment at the window boundary** —
      naming all five excluded mutations, the rule excluding each (invariant registry / shared
      registration / R20.31), and the **R20.26 forward-advance** note (`convertAndStorePlugin`
      overwrites in place, so a failed install may have advanced the cached emission)
- [ ] **THE CLOSED-SET TEST** (the load-bearing deliverable): scan the pre-window region and assert
      its mutation set EQUALS the enumerated five, so a sixth mutation added above the boundary
      REDS. Verify the scanner sees both mutation forms (direct call and via-helper) — a scanner
      blind to a form reports a closed set it never measured
- [x] Drive-by defect fixed: `:880` pushed `G08: WARN` from inside **G13's** catch, attributing a
      conversion failure to the R17 core-plugin gate 100 lines above. Nothing asserted on the old
      string (grepped)
- [x] `InstallElement`'s callers enumerated, and each checked against the new error shape — **6
      sites, none parses `result.error`; the only coupling is `:10100`'s `G05`/`G06` op-label
      filter** (see Problem §1). The "callers branch on the error" worry this card was authored
      with is retracted there.
- [ ] The window implemented, with every compensation either neutered-and-pinned or explicitly
      recorded as latent/unreachable
- [ ] `MAX_HANDROLLED` 1 → 0, `MIN_TRANSACTIONAL` 18 → 19, `InstallElement` added to
      `MUST_BE_TRANSACTIONAL` — and the ratchet's claim RENAMED from *"transactional"* to
      **"windowed per the R51 boundary rule"**, so `0` stops overclaiming while five mutations sit
      outside every window
- [ ] tsc clean · suite at/above baseline · `trddgrep validate` exit 1 with only the two known cards

## Approval log

- 2026-07-31T20:15:22+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a refactor
  inside this agent's own assignment scope, carved out of the mandated TRDD-DQ6XN2VP because it is a
  distinct problem. Pre-approved: issuer authority >= required approver. No approval request sent.
