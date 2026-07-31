---
trdd-id: RO90UCKQ
title: ChangePlugin G11 verifies the final state and its verdict changes nothing
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T21:56:29+0200
updated: 2026-07-31T22:19:32+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-31T21:56:29+0200
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body)

**THIS CARD'S ORIGINAL PREMISE WAS FALSE, AND I WROTE IT.** Filed an hour earlier claiming
*"`result.success` is assigned exactly twice, both times to `true`, so ChangePlugin never reports
failure"*. That sentence is literally true about ASSIGNMENTS and completely wrong about BEHAVIOUR:
**`result` is INITIALIZED `success: false`** (`:4617`). So every gate that does
`result.error = …; return result` returns a failure, and the two `= true` assignments are the two
EXCEPTIONS — the no-op path (`:4745`) and the terminal success path (`:5001`) — not the rule.

Refuted three independent ways, all first-hand: the initializer; the exit trace (15 `return result`,
all but the success paths leaving `success` at its `false` default with an error set); and **12
existing tests already assert `ChangePlugin(...).success === false`.**

*Grepping assignments to a field answers nothing about a field whose INITIALIZER is the value you
are asking about.* That is now a lesson in `.claude/rules/lessons-verification.md`.

**THE CALLER AUDIT — the work this card said it was — IS DONE, and it inverts the risk.** All **15**
production call sites already handle `success === false`, every one deliberately:

| caller | on failure |
|---|---|
| `app/api/agents/[id]/local-plugins/route.ts:81` | HTTP 400 with `result.error` |
| `app/api/agents/role-plugins/install/route.ts:68` · `:122` | HTTP 400 |
| `app/api/settings/global-plugins/route.ts:234` | HTTP 400 |
| `app/api/settings/marketplaces/route.ts:886` · `:897` | retries the next candidate key, then HTTP 500 |
| `services/auto-update-service.ts:312` · `:337` · `:474` | ledger entry `failed` (or `already-current` on an idempotent-looking message) |
| `services/element-management-service.ts:3726` | records only on success (inside an uninstall loop) |
| `services/element-management-service.ts:3795` · `:3932` | pushes to `problems[]` |
| `services/element-management-service.ts:5115` · `:5174` · `:5232` | records `success:` per target in the returned report |

Not one is written on the assumption that this pipeline cannot fail — which was the card's stated
MED-HIGH risk. **That risk is refuted; the remaining question is narrow.**

## The defect that DOES survive

G11 (`:4898`-`:4922`) only `ops.push`es. Execution continues past it to `result.success = true`
(`:5001`), so a **genuine** `finalState !== expectedState` — on a settings file that read cleanly —
returns SUCCESS. The verdict is computed, printed, and wired to nothing.

That is the same asymmetry `InstallElement`'s PG01 carries a comment about having already fixed one
gate over: *"Was WARN-only while install/enable above set success=false. That asymmetry meant an
uninstall which left the plugin installed reported SUCCESS: the UI cleared, the caller moved on, and
the plugin kept loading."* PG01 flips `success` on three of its four arms; `ChangePlugin`'s G11 on
none of its arms.

Note G10 runs immediately before and force-writes the missing key, so reaching a G11 mismatch means
**both** the CLI/adapter and the G10 safeguard failed. That is a genuinely broken state, not a
routine one — which is an argument for wiring it, and also why nobody has hit it.

## THE FLIP WAS TRIED AND REVERTED — and the reason is the finding

Wiring G11 to fail on a genuine mismatch was implemented, run, and **reverted the same session**.
It reddened **15 tests**, and 13 of those were fixture artifacts worth fixing (their mocked `fs`
never persists the write, so G11 legitimately mismatched and the old WARN hid it — those tests
literally assert that an install whose settings file lacks the plugin afterward is a SUCCESS).

**The other 2 were not artifacts, and they settle the question:**

```
tests/integration/change-marketplace-rollback.test.ts
  × reinstalls every plugin the cascade uninstalled when the CLI refuses to deregister
  AssertionError: expected 'CRITICAL — THE COMMAND FAILED AT GATE…' to contain 'NO CHANGES WERE MADE'
```

`ChangeMarketplace::remove`'s **R51 compensation reinstalls plugins by calling `ChangePlugin`**. With
G11 failing, the ROLLBACK reports failure — which does not surface as "the reinstall did not verify",
it escalates to R51.5: *"THE SYSTEM IS IN AN INVALID STATE … Manual repair is required — do NOT retry
the command"* — about a system that was in fact restored.

**That is the same failure mode `TRDD-K71FV649` established one card earlier**: a verification wired
to abort turns a recoverable situation into a reported catastrophe. I argued PG01 must not do it and
then did it to G11.

**So the answer differs by CALLER, not by action** — which is not what this card assumed:

| caller kind | a G11 failure is |
|---|---|
| the four user-initiated HTTP-400 routes | **right** — the user asked for a change that did not land, and 400 is the truthful answer |
| the R51 compensation path (`ChangeMarketplace::remove` → reinstall) | **wrong** — it converts a successful rollback into a CRITICAL "unrecoverable" verdict |

Telling those apart is a **signature change across 15 call sites** (an explicit "this call is a
compensation" flag, or a separate verify-and-report entry point). Until that is designed, **a WARN
that under-reports is strictly better than a failure that declares a recovered system unrecoverable**
— and that is now recorded in the code at G11, so the next reader does not re-try it blind.

## What remains to decide

1. **How a caller declares itself a COMPENSATION** — the blocker the flip found. Options: an
   explicit `isCompensation` flag on the `desired` object (15 call sites to audit, but only one to
   set); a separate `verifyOnly`/`skipVerify` entry point; or moving the verdict out of `ChangePlugin`
   into the callers that want it. Whichever wins, the compensation path must NOT be able to report
   R51.5 CRITICAL because a read-back disagreed.
2. Only then, per action (`install` / `uninstall` / `enable` / `disable` / `update`): is a G11
   mismatch a FAILURE? The evidence says yes for user-initiated calls — PG01 concluded both
   directions of a lifecycle must fail by the same rule.
3. The 13 fixture tests that assert "install succeeded with the plugin absent from settings" need
   their mocks to MODEL the write. They currently encode the bug, which is the shape
   `.claude/rules/lessons-verification.md` records as "a test propped up by the very bug you are
   fixing" — fix the fixture, never weaken the guard.
4. Should it ABORT (roll back) rather than merely report? Still open, still larger; unchanged.

**The `unreadable` case must NOT gate**, whatever is decided. `TRDD-K71FV649` settled that — an
invariant may abort on a positive VIOLATION and never on an UNKNOWN — and G11 already reports the
unreadable case as its own distinct WARN (`69e801a9`). A fix that collapses the two re-opens what
that card closed.

## Verification

- A test driving `ChangePlugin` to a G11 mismatch with a READABLE settings file, asserting
  `success === false` (today `true`), plus the symmetric uninstall case.
- POSITIVE CONTROL: a matching settings file still succeeds — the change must not be "fail always".
- POSITIVE CONTROL: an UNREADABLE settings file still succeeds with the K71FV649 WARN. The two cases
  must stay distinguishable; a fix that collapses them re-opens a closed card.
- The neuter: revert the flip, name the tests that red.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above the day's baseline
  (re-measure, never quote: 320 files / 4567 passed / 2 skipped at `6d818c12`).

## Estimated risk

**LOW-MED, downgraded from MED-HIGH by the audit.** The feared blast radius — callers assuming this
pipeline cannot fail — does not exist: all 15 already branch on it, and 12 tests already exercise the
failure path. What is left is the semantic call in step 1, plus whatever step 2 decides.

## Acceptance

- [x] Every caller of `ChangePlugin` enumerated with what it does on `success === false` — **15
      production sites, all handling it deliberately** (table in the STATE block). This is what
      refuted the card's own premise and its MED-HIGH risk rating
- [x] Per-action verdict recorded — and the audit found the axis is **not per-action but
      PER-CALLER**: a failure is right for the four user-initiated routes and wrong for the R51
      compensation path, where it escalates to "the system is unrecoverable". Measured by
      implementing the flip and reading what broke; reverted, with the reasoning left at G11 in the
      code so the next reader does not re-try it blind
- [ ] A caller can declare itself a COMPENSATION (the blocker the flip found) — flag, separate entry
      point, or move the verdict to the callers. Whichever wins, the compensation path must not be
      able to report R51.5 CRITICAL because a read-back disagreed
- [ ] The 13 fixture tests that assert "install succeeded with the plugin absent from settings" have
      mocks that MODEL the write — they currently encode the bug
- [ ] The `unreadable` case verified to still NOT gate, with the test that proves it
- [ ] Abort-vs-report (the R51 window question) decided and recorded, even if the answer is "not now"
- [ ] Tests + neuter recorded by name · tsc clean · suite at/above baseline

## Approval log

- 2026-07-31T21:56:29+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, found while auditing TRDD-K71FV649 and deliberately filed
  separately because it is independent of that card's reader. Pre-approved: issuer authority >=
  required approver.
