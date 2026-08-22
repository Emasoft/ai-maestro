---
trdd-id: JWE3CFLV
title: The four simple-element pipelines never authorized — changeSimpleElement had no Gate 0
column: complete
created: 2026-08-22T22:11:32+0200
updated: 2026-08-22T22:13:10+0200
current-owner: user
created-by: user
task-type: security
implementation-commits: [6d66db22]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:11:32+0200
---

# The four simple-element pipelines never authorized — changeSimpleElement had no Gate 0

## Problem

`changeSimpleElement` in `services/element-management-service.ts` backs four exported pipelines —
`ChangeAgentDef`, `ChangeCommand`, `ChangeRule`, `ChangeOutputStyle` — and it was the **only**
element pipeline in that file with **no `gate0Auth` call at all**. Eighteen siblings have one.

Its single production caller is `POST /api/agents/[id]/remove-element`, whose own comment asserts:

> Authenticate before any mutation. The Change* pipelines run their own Gate 0 authorization on
> the resolved authContext.

That is TRUE for the `ChangeSkill` and `ChangeMCP` arms of the same `switch`, and FALSE for these
four. **So any AUTHENTICATED agent of ANY title could delete another agent's rules, commands,
agent-definitions and output-styles** — including the `.claude/rules/` files that constrain that
agent. Same class as TRDD-F1SL03CK: authentication standing in for authorization.

### How it was found

By working TRDD-CAVCTULL's open box *"the 12 forward-only routes verified against their pipelines'
Gate 0"*. That box exists because CAVCTULL established that `buildAuthContext(` proves a route
FORWARDS a caller, never that the receiving pipeline authorizes. This is the first verification of
one, and it found the theory false for 4 of the 6 pipelines that one route forwards into.

### Why it survived review

The IRON never-user-scope gate (`G00b`) sits exactly where a reader expects the authorization gate.
It is not one. It is conditional on `scope === 'user'` **and** a state-ADDING action, and
`USER_SCOPE_STATE_ADDING_ACTIONS` is `{install, enable, update, convert, add}` — **`remove` is not
in it**, and the removal route always passes `scope: 'local'`. On the one live path G00b is a no-op.

**A conditional gate next to no gate looks exactly like a gate.** The same block's own comment had
already noticed the sibling gap for the IRON rule (*"the gate was wired only into
InstallElement/ChangePlugin/ChangeSkill, so these siblings were UNGATED"*) and closed only that
half; the authorization gap beside it went unnamed.

### Why the existing suite could not catch it

Every call in `tests/services/element-management-service.test.ts` passes
`_tAuth = { isSystemOwner: true }`, which short-circuits `gate0Auth` on its FIRST line. Those tests
stayed green through the whole defect and would stay green if the gate were deleted again.

## Fix

One guard at the shared choke point, not four at the delegators: `gate0Auth('manage-skills', ...)`
as an unconditional G00 before G00b. `'manage-skills'` is the action every sibling element pipeline
already uses (`ChangeSkill`, `ChangeMCP`, `ChangeLSP`, `ChangeHook`, `InstallElement`,
`ChangePlugin`) — same kind of act, same authority, one vocabulary.

`ledgerOp` and `authContext` go from optional to required. The optional `authContext` is what made
a scope-CONDITIONAL gate expressible at all; all four delegators already declare
`authContext: AuthContext` non-optional and pass both, so **no call site changed**.

**Blast radius, measured before editing:** `changeSimpleElement` has exactly 4 callers (the
delegators); the delegators have exactly 1 production caller; it already passes `auth.context`.
**Headless parity:** `services/headless-router.ts:1340` imports the same route module, so one fix
covers both modes.

## Verification

`tests/unit/change-simple-element-authorization.test.ts`, 6 cases, non-system-owner contexts
throughout. Each denial pins the REASON (`success === false` alone is satisfied by any later gate
failing) and asserts the abort happened AT G00 (no `G01:` in the ops trace).

**NEUTER, via `scripts/dev/neuter`, restore verified by blob hash:**
`s/const g0err = await gate0Auth/const g0err = null && await gate0Auth/ if $. == 6226` → **6 red /
0 green.** Line-anchored deliberately: that expression appears at SIX sites in the file
(4632/6020/6226/6404/6535/6677), and a shape-matched neuter would have hit every element pipeline
at once and produced a plausible red set. A first hand-rolled attempt was refused by its own
site-count assertion for exactly that reason.

Predicted 5 red, observed 6 — the positive control also reds, because it asserts the ops trace
carries `G00: Authorized` and deleting the gate removes that line. Recorded rather than
rationalised: it is a control that the SHIPPED gate answers both ways on the same input shape with
only the caller's title differing.

`tsc --noEmit` 0 lines. 117/117 green across the new file plus the two suites this could disturb.

## Effect on TRDD-CAVCTULL

The forward-only count stays **12** — the fix is in the SERVICE, so the route still carries no
STRONG needle of its own. What changed is that `remove-element` is now VERIFIED rather than
UNVERIFIED, and the verification found a hole. **11 remain unverified.**

## Estimated risk

LOW to ship, HIGH had it stayed. The change only ADDS a refusal on a path that had none, its one
production caller already supplies the context, and the deny path needs no registry lookup.

## Acceptance

- [x] `gate0Auth('manage-skills', …)` added as an UNCONDITIONAL G00 at the shared choke point
      (`changeSimpleElement`), not four times at the delegators
- [x] `ledgerOp` / `authContext` made REQUIRED — the optional `authContext` is what made a
      scope-conditional gate expressible; verified all four delegators already declare it
      non-optional, so no call site changed
- [x] blast radius measured BEFORE editing: 4 callers of the helper, 1 production caller of the
      delegators, and it already passes `auth.context`
- [x] headless parity: `services/headless-router.ts:1340` imports the same route module, so one
      fix covers both server modes
- [x] denial test for each of the four pipelines, pinning the REASON and asserting the abort
      happened AT G00 (no `G01:` in the ops trace) — `success === false` alone would be satisfied
      by any later gate failing
- [x] the self-reconfiguration case covered (a MANAGER may not strip its OWN elements via the API)
- [x] a MANAGER positive control, so the denials are a decision and not a blanket refusal
- [x] NEUTER via `scripts/dev/neuter`, line-anchored to site 6226 of six: **6 red / 0 green**,
      restore verified by blob hash; the observed count (6) recorded over my predicted 5
- [x] `tsc --noEmit` 0 lines; 117/117 green across the new file and the two suites this could
      disturb

## Approval log

- 2026-08-22T22:11:32+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
