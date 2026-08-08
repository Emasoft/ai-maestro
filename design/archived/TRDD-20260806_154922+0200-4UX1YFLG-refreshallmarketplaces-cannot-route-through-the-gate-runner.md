---
trdd-id: 4UX1YFLG
title: RefreshAllMarketplaces breaks the AIO-TXN-10 ratchet and cannot route through the gate runner as designed
column: completed
created: 2026-08-06T15:49:22+0200
updated: 2026-08-08T16:24:24+0200
implementation-commits: [36dcf799]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager, repo Emasoft/ai-maestro-assistant-manager-agent)
approval-datetime: 2026-08-08T16:22:38+0200
priority: 1
severity: medium
effort: small
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [governance, aio-txn-10, ratchet, regression]
npt: []
eht: []
blocked-by: []
relevant-rules: []
---

# RefreshAllMarketplaces breaks the AIO-TXN-10 ratchet

## The regression, and whose it is

`tests/governance/aio-txn-10-runner-coverage.test.ts` fails **deterministically** — 3 of 3 full-suite
runs, 2026-08-06, identical every time, while all 400 other files pass (5572 tests green):

```
AIO-TXN-10 violated by 1 pipelines (ratchet allows 0).
Still hand-rolled:
  RefreshAllMarketplaces (1 gate ops)
```

**This is my regression and I mislabelled it repeatedly.** A session handoff recorded it as
"pre-existing, NOT mine", and I repeated that several times without checking. Git says otherwise:

- `MAX_HANDROLLED = 0` was set on **2026-07-31** (`92c61ca5`).
- `RefreshAllMarketplaces` was introduced on **2026-08-06 07:57** (`7c104ba4`, TRDD-PE54D95Q AC1).
- `git merge-base --is-ancestor` confirms the ratchet reached 0 **first**.

So a new hand-rolled pipeline was added against a zero ratchet. The lesson is the one already in
the rules and it caught me anyway: **a note from an earlier session is a second-hand report** — the
two commands that settle it cost less than the sentence repeating the claim.

## Why the obvious fix does not work

`RefreshAllMarketplaces` (`services/element-management-service.ts:5467`) is two auth gates and then
ONE side effect — `claude plugin marketplace update` — with nothing abortable after it. It has no
rollback window at all.

And `lib/gate-transaction.ts:126` **refuses to start** a sequence containing a mutating gate with no
`undo`:

> "Refuse to start rather than discover mid-flight that a gate cannot be undone — by then the
> damage is done and the guarantee is already broken."

A marketplace catalog refresh has no meaningful `undo`: you cannot un-fetch, and there is nothing
harmful to reverse. So the function **cannot** be wrapped as the runner is designed.

## Three options — and two of them are traps

1. **Declare the exec gate `readOnly: true`.** ✗ It is a lie — the refresh mutates local catalog
   state — and it defeats the precheck that exists precisely to stop "I'll add the undo later"
   from becoming permanent.
2. **Rename or drop the `G03:` op so the detector stops counting it.** ✗ Gaming a name-keyed
   detector. The offender renames its way out and the rule stops meaning anything.
3. **Decide what AIO-TXN-10 means for a single-action privileged call**, and make the detector say
   it. A function with ONE terminal side effect and no window is arguably not a "pipeline" in the
   sense the rule governs — but narrowing a conformance detector to exclude the function that
   just violated it is exactly the shape of routing around a rule, so it must be a deliberate,
   documented decision rather than a quiet edit.

Option 3 is the only honest one, which is why this is a proposal and not a commit.

## Why this needs MANAGER and not a self-mandate

It changes a governance conformance rule (or its detector), which the tier table puts at `manager`.
An agent narrowing the rule that just caught its own regression is precisely the case the approval
gate exists for.

## Verification

`bash scripts/with-node.sh npx vitest run tests/governance/aio-txn-10-runner-coverage.test.ts`
→ must pass with `MAX_HANDROLLED` **still 0** (the ratchet never rises). Whichever option is
chosen, that command is the acceptance.

## Estimated risk

**LOW as code, MEDIUM as governance.** The failing gate blocks nothing at runtime; the risk is
setting a precedent that a conformance detector may be narrowed by whoever trips it.

## Acceptance

- [x] MANAGER rules on which of the three options applies — option 3, APPROVED 2026-08-08 as an
      R51.6 limit case (see Approval log; never "exempt")
- [x] `aio-txn-10-runner-coverage` passes with `MAX_HANDROLLED` still 0 — 5/5 green locally
      (36dcf799), including the new gate-count companion that voids the entry on a second gate
- [x] If option 3: the detector's definition of "pipeline" is stated in the test's own comment, so
      the next reader learns the boundary rather than re-deriving it — the `R516_LIMIT_CASES`
      docblock carries the ruling's wording and the revisit bar

## Approval log

- 2026-08-06T15:49:22+0200 — Authored as a proposal. Not self-mandated: the fix is a governance
  decision about a conformance rule, and the agent proposing it is the one whose commit broke it.
- 2026-08-08T16:22:38+0200 — **APPROVED by MANAGER (min-approval-requirement: manager).** The
  MANAGER's ruling, recorded verbatim (first delivery ~16:08 was lost to a context compaction;
  resent on request — the lesson is the methodology's §3, record the decision in the card the
  moment it arrives, not the moment you act on it):
  > **APPROVED — TRDD-4UX1YFLG, MANAGER, 2026-08-08.** Not as an exemption: R51 is already
  > satisfied. R51.0 directs that a case not covered by a clause be derived from the AIM ("an
  > all-in-one function ALWAYS leaves the system in a valid state"), and R51.6 (irreversible
  > effects go LAST) is met in its limit case by a single terminal gate — it is last because it
  > is the only one. R51.4's compensation exists to restore validity when a LATER gate fails;
  > with no later gate there is no failure path for an undo to protect. The AIM holds, so the
  > rule is met and the DETECTOR was over-specified — it measured "has a compensation" as a
  > proxy for "is transactional", and the proxy misfires on the degenerate single-terminal-gate
  > case. Approved on that basis, with the allowlist worded as a limit case and the gate-count
  > companion test required, not optional.
  MANAGER also ruled option 3 the only defensible one (1 is a lie the detector would believe,
  2 is gaming — both defeat R51.0), and placed on the record that not self-approving one's own
  regression is what makes the approval mean anything.
- 2026-08-08T16:24:24+0200 — COMPLETED by ai-maestro. Implementation landed as `36dcf799`
  (R516_LIMIT_CASES allowlist + gate-count companion test); acceptance verified: the ratchet
  file 5/5 green with MAX_HANDROLLED still 0.
