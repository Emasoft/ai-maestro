---
trdd-id: RO90UCKQ
title: ChangePlugin never sets success to false so G11 can report the wrong final state and still succeed
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-31T21:56:29+0200
updated: 2026-07-31T21:56:29+0200
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

## Problem

Measured 2026-07-31 across `ChangePlugin`'s whole span (`services/element-management-service.ts`
`:4728`-`:5222`): `result.success` is assigned **exactly twice, and both times to `true`**
(`:4872`, `:5128`). There is no path on which this pipeline reports failure.

So G11 — its own final-state verification — is decorative on the case it exists for:

```ts
} else if (finalState !== expectedState) {
  ops.push(`G11: WARN — Final state ${finalState} != expected ${expectedState}`)
}   // …and the function goes on to return success
```

A caller that asks to install a plugin, and whose settings file demonstrably does NOT have it
enabled afterward, is told the operation succeeded. The UI updates, the caller moves on, and the
plugin is not loaded.

**This is the same asymmetry that was already fixed one gate over.** `InstallElement`'s PG01 carries
the comment: *"Was WARN-only while install/enable above set success=false. That asymmetry meant an
uninstall which left the plugin installed reported SUCCESS: the UI cleared, the caller moved on, and
the plugin kept loading."* PG01 was repaired; `ChangePlugin` was not, and it is weaker still — PG01
flips `success` on three of its four arms, `ChangePlugin` on none.

## Not a K71FV649 defect — which is why it is its own card

Found while auditing `TRDD-K71FV649` (the reader that could not tell *unreadable* from *absent*), and
deliberately NOT folded into it: this defect is independent of the reader. It would be exactly as
true with a perfect one, because the bug is that a KNOWN-BAD verdict changes nothing. K71FV649's
remit was the reader; conflating the two would have hidden a false-success behind a reader fix.

It is likewise **not derived** from K71FV649: that card's change did not create this, it merely
walked past it.

## What the fix has to decide (it is a behaviour change, not a patch)

`ChangePlugin` is called from many places, including `ChangeTitle`'s role-plugin swap. Making it
report failure changes what every one of those callers sees, so the work is the CALLER AUDIT, not
the two-line flip:

1. Enumerate every caller of `ChangePlugin` and what each does with `success === false`.
2. Decide per action (`install` / `uninstall` / `enable` / `disable` / `update`) whether a G11
   mismatch is a failure or a warning — PG01 concluded that BOTH directions of a lifecycle must fail
   by the same rule, and the same argument likely applies here.
3. Decide whether it should go further and ABORT (roll back) rather than merely report — that is an
   R51 question about `ChangePlugin`'s window, and it is a different, larger decision. Record the
   verdict either way; do not let step 3's size block steps 1-2.

**The `unreadable` case must NOT gate**, whatever is decided for the rest. `TRDD-K71FV649` settled
that: an invariant may abort on a positive VIOLATION and never on an UNKNOWN, and G11 already
reports the unreadable case as its own distinct WARN (`69e801a9`).

## Verification

- A test driving `ChangePlugin` with a settings file that does NOT contain the key after an install,
  asserting `success === false` (today it is `true`) — plus the symmetric uninstall case.
- POSITIVE CONTROL: a settings file that DOES match still succeeds, so the change is not "fail
  always".
- POSITIVE CONTROL: an UNREADABLE settings file still succeeds with the K71FV649 WARN — the two
  cases must stay distinguishable, and a fix that collapses them re-opens the bug that card closed.
- The neuter: revert the flip and name the tests that red.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above the day's baseline
  (re-measure, never quote: 320 files / 4564 passed / 2 skipped at `a044f390`).

## Estimated risk

**MED-HIGH.** The edit is trivial and the blast radius is the caller audit: a pipeline that has never
returned failure may have callers written on the assumption that it cannot, and `ChangeTitle`'s
role-plugin swap is one of them. Step 1 is the work.

## Acceptance

- [ ] Every caller of `ChangePlugin` enumerated with what it does on `success === false`
- [ ] Per-action verdict recorded for a G11 mismatch (fail vs warn), with the PG01 asymmetry
      argument addressed explicitly
- [ ] The `unreadable` case verified to still NOT gate, with the test that proves it
- [ ] Abort-vs-report (the R51 window question) decided and recorded, even if the answer is "not now"
- [ ] Tests + neuter recorded by name · tsc clean · suite at/above baseline

## Approval log

- 2026-07-31T21:56:29+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, found while auditing TRDD-K71FV649 and deliberately filed
  separately because it is independent of that card's reader. Pre-approved: issuer authority >=
  required approver.
