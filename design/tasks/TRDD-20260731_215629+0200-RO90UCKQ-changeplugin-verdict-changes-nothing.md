---
trdd-id: RO90UCKQ
title: ChangePlugin G11 verifies the final state and its verdict changes nothing
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T21:56:29+0200
updated: 2026-07-31T22:12:57+0200
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

## What remains to decide

1. Per action (`install` / `uninstall` / `enable` / `disable` / `update`), is a G11 mismatch a
   FAILURE or a warning? PG01 concluded both directions of a lifecycle must fail by the same rule;
   the same argument likely applies.
2. Should it ABORT (roll back) rather than merely report? That is an R51 question about
   `ChangePlugin`'s window and is a larger decision — record the verdict either way, and do not let
   its size block step 1.

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

## Approval log

- 2026-07-31T21:56:29+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, found while auditing TRDD-K71FV649 and deliberately filed
  separately because it is independent of that card's reader. Pre-approved: issuer authority >=
  required approver.
