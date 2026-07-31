---
trdd-id: YAGRX7W3
title: Make InstallElement transactional — the last AIO-TXN-10 row, and the one with forbidden compensations
column: planned
scope: project
project-id: ai-maestro
created: 2026-07-31T20:15:22+0200
updated: 2026-07-31T20:15:22+0200
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

**NEXT ACTION:** answer the design question below — *what does an all-or-nothing guarantee mean for
a pipeline three of whose mutations may not be reversed?* — and record the answer HERE before
writing a line of code. Do not open the editor first.

**DO NOT** start by wrapping the EXE settings write and lowering the ratchet to 0. That is the
shape the other eight took and it is wrong here: it would move the conformance number while leaving
the three genuinely-uncompensatable mutations unaddressed, and the ratchet would then read
"complete" over exactly the pipeline that isn't.

## Problem

`services/element-management-service.ts:567-1486` (920 lines). Two things make it unlike the eight
single-mutation pipelines retrofitted at `2613c907`:

1. **Other retrofitted pipelines CALL it.** Converting it changes *their* failure semantics, not
   just its own. A caller that today sees `{success: false, error: 'Marketplace registration
   failed'}` would start seeing the R51.3 `NO CHANGES WERE MADE` message with the cause nested —
   and some of those callers branch on the error. Enumerate them before changing the shape.
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

**What the parent card got RIGHT, re-verified here rather than inherited:**

| mutation | why a compensation may not reverse it | verified |
|---|---|---|
| `mkdir(<agentDir>/.claude)` — G07 `:718`, EXE `:894` | `.claude/` is the `claude-dir` row of the agent-invariant registry, so the watchdog *guarantees* it exists. An undo deleting it fights the loop that re-creates it. | `lib/agent-invariants.ts:69` ✓ |
| `claude plugin marketplace add` — G11 `:829` | a SHARED, idempotent registration in the user's Claude config. Deregistering it on rollback breaks every OTHER agent installing from that marketplace. | read at `:829` ✓ |
| `convertAndStorePlugin` + `emitForClient` — G12 `:872-873` (and a second `emitForClient` at `:912`) | writes into `~/agents/custom-plugins/`. **R20.31, verdict Explicit**: *"AI Maestro NEVER DELETES a plugin folder from them … Removing a source folder is explicitly the user's responsibility."* A compensation deleting it violates a rule marked Explicit. | `docs/GOVERNANCE-RULES.md:883` ✓ |

Note the parent card labels the conversion gate `G13`; the op label emitted around `:861-873` is
**`G12`**. Use the emitted label.

**Also still true:** the two USER-scope writes (`PG03` `:1258`, `PG07` `:1453`) are **REPAIRS, not
creators of a disagreement** — each fires only after a *local* install succeeded and each *turns
OFF* an already-enabled user-scope copy. When either fails, user scope is left exactly as the caller
found it, so R51's "return to exactly the state it was in" is satisfied by doing nothing. The
disagreement they address PRE-DATES the call.

## The design question this card exists to answer

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

- [ ] The design question answered and the choice + its uncovered surface recorded in this card AND
      in the code comment at the window boundary
- [ ] `InstallElement`'s callers enumerated, and each checked against the new error shape
- [ ] The window implemented, with every compensation either neutered-and-pinned or explicitly
      recorded as latent/unreachable
- [ ] `MAX_HANDROLLED` 1 → 0, `MIN_TRANSACTIONAL` 18 → 19, `InstallElement` added to
      `MUST_BE_TRANSACTIONAL` — and the ratchet's comment updated to say what the number now means
      given the mutations outside the window
- [ ] tsc clean · suite at/above baseline · `trddgrep validate` exit 1 with only the two known cards

## Approval log

- 2026-07-31T20:15:22+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a refactor
  inside this agent's own assignment scope, carved out of the mandated TRDD-DQ6XN2VP because it is a
  distinct problem. Pre-approved: issuer authority >= required approver. No approval request sent.
