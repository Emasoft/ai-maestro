---
trdd-id: OYNUJRSB
title: renameSession has no ownership check so any agent can rename any agent's session
column: complete
created: 2026-08-22T23:19:42+0200
updated: 2026-09-04T18:11:38+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T23:19:42+0200
implementation-commits: [17dd2c72]
---

# renameSession has no ownership check so any agent can rename any agent's session

## Problem — any authenticated agent can rename any other agent's session

`renameSession(oldName, newName)` (`services/sessions-service.ts`) takes the session name from the
URL and performs the rename. It has **no `authContext` parameter, no `agentId` comparison, no
`authorize()` call, no ownership check of any kind** — verified by grepping its whole body for
`authContext|authorize|agentId|isSystemOwner|owner`, which returns nothing.

Both server modes reach it with authentication only:

| mode | site | guard |
|---|---|---|
| Next.js | `app/api/sessions/[id]/rename/route.ts:26` | `enforceAuth` |
| headless | `services/headless-router.ts:890-895` | `authenticateAgent` (SVC2-MAJ-12) |

Both comments are about authenticating, and both are satisfied. Neither asks WHOSE session it is.
So any agent holding a valid AID token — of any governance title, on any team — can rename the tmux
session of any other agent on the host.

## Why this is worth a card rather than a one-line fix

The blast radius is real but not catastrophic: a tmux session name is the agent's runtime identity,
and renaming another agent's session can orphan it from the dashboard binding — a denial of service
against a peer, not a privilege escalation or a disclosure.

**What makes it a card is that the correct policy is not obvious, and inventing one would be the
error.** Three candidate rulings, none derivable from the code as it stands:

1. **System-owner only**, matching `teams/[id]/batch-create-agents`, which hand-rolls exactly that
   (`if (auth.agentId) return 403`). Simplest, and consistent with a peer route of similar reach.
2. **Ownership check** — the caller may rename only the session bound to its own `agentId`. Needs a
   session→agent lookup that `renameSession` does not currently do, and the sibling route
   `sessions/activity/update` explicitly REJECTED that same lookup on perf grounds (its comment
   names the cost and an O(1) cache as the upgrade path). That precedent argues against it here
   unless the cost is measured rather than assumed.
3. **A new `authorize()` action.** `lib/authorization.ts`'s vocabulary is
   `approve archive change-title create-agent delete-agent edit export-agent manage-team
   manage-trdd promote refuse register-agent unblock-prompt` — there is no session verb at all, so
   this would be a governance-vocabulary change, not an implementation detail.

Option 3 is the one that must not be taken quietly: adding a verb to the authorization vocabulary
is a governance decision, and the same reasoning that keeps TRDD-HW72YBZW from wiring an invented
default applies here.

## Proposed fix

Rule between (1) and (2), then apply it in **BOTH** modes in one commit — `services/headless-router.ts`
reimplements this route, so a guard added only to `app/api/` is half-applied by construction
(measured on its sibling: `GET /api/sessions/restore` had the identical gap in both modes and
needed two fixes and two independent tests, TRDD-R268J32X commit `d6f78e2b`).

Whichever is chosen, pin it TWICE — the Next route and the headless router are independent code
paths and neither test can see the other's regression.

## Verification

- A non-owner authenticated caller is refused, and the refusal names the REASON, not merely a
  non-200 (a thin body already yields 400 from validation, which would pass with the gate deleted).
- `renameSession` is not reached on the refused call — a 403 over a completed rename is not a
  refusal.
- Positive control: the permitted caller still renames, so the refusal is a decision and not a
  blanket denial.
- Neutered in both files, line-anchored: the route file spells `if (authErr) return authErr` at
  several sites, so an unanchored mutation disables guards the test does not cover.

## Estimated risk

LOW to fix once the policy is chosen; the risk is in choosing wrong. Defaulting to system-owner-only
could break a legitimate self-rename flow if one exists — though no browser code calls this route at
all (verified with a positive control on the same grep, which found `BuildAction.tsx` for a route
that IS called), so the surface is CLI/agent callers only.

## Provenance

Found while draining TRDD-R268J32X's authentication-only ledger one route at a time. It was IN that
ledger as an unchecked assertion; this card records that the assertion is wrong. Sibling verdicts
from the same pass: `sessions/activity/update` CLEAR (explicitly decided in place, with reasoning),
`sessions/restore` GET FIXED (unauthenticated in both modes).

## Approval log

- 2026-08-22T23:19:42+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Acceptance

- [x] the policy is RULED between system-owner-only and an ownership check, with the reason
      recorded here — **SYSTEM-OWNER-ONLY**, see the ruling section below
- [x] if a new `authorize()` action is proposed instead, it is escalated as a governance-vocabulary
      change and NOT added quietly — **not proposed.** The ruling uses the existing shared
      primitive `enforceSystemOwner`, so no verb was added and nothing was escalated
- [x] the ruling is applied in BOTH `app/api/sessions/[id]/rename/route.ts` AND
      `services/headless-router.ts` in ONE commit — `17dd2c72`
- [x] pinned by a test in each mode, and each neuter reddens only its own test (line-anchored) —
      `tests/unit/session-rename-system-owner.test.ts` (3 cases) and
      `tests/unit/headless-session-rename-system-owner.test.ts` (2). **Both neuters RUN:** swapping
      the Next gate back to `enforceAuth` reds the 2 Next denials and leaves headless green;
      deleting the headless `isSystemOwner` check reds the 1 headless denial and leaves Next green
- [x] the refusal asserts the REASON (`/system owner only/i`), and proves `renameSession` was never
      reached — `mockRename` is asserted `not.toHaveBeenCalled()` in both modes
- [x] a positive control shows the permitted caller still renames — 200 plus the exact
      `renameSession('victim-agent', 'renamed-by-owner')` call, in each mode

## RULING 2026-09-04 — SYSTEM-OWNER-ONLY, and the two facts this card did not have

The card asked for a ruling between (1) system-owner-only and (2) a per-caller ownership check,
and warned that choosing by whichever is easier to code would be the error. Two measurements taken
before ruling settled it, and neither was in the card:

1. **The route is `@deprecated` in its own docstring**, with a documented replacement —
   `PATCH /api/agents/[id]` — which is **already properly gated** (it builds an authContext and
   hands it to `updateAgentById`, verified). So no caller NEEDS this route.
2. **It is PAST its own stated removal target.** The docstring says *"Removal target: v0.28.0"*;
   `package.json` reads **0.29.0**. The long-run answer is DELETION, not a better guard.

That reframes the choice. Option 2 would build a session→agent lookup — the very lookup the sibling
`sessions/activity/update` explicitly REJECTED on perf grounds, naming the cost in its own comment
— to protect a route scheduled for removal. **Paying for infrastructure on a corpse.** Option 1 is
the strictly-safe interim: it cannot be wrong in the direction that matters, it matches the peer
precedent the card itself names (`teams/[id]/batch-create-agents`), and it uses the SHARED
primitive `enforceSystemOwner` rather than the hand-rolled `if (auth.agentId) return 403`.

**Option 3 was not taken**, as the card required: `authorize()` still has no session verb, and none
was added. No governance vocabulary changed.

### The residue this ruling deliberately does NOT close

**The route is past its removal target and still ships.** Deleting a public API route is a
breaking public-API change, whose D3 objective floor is `user` — so it is not mine to make under
this card's `manager` requirement, and this card is not the place to smuggle it. Recorded here as
the open successor rather than left as an unstated implication: *the deprecated route
`PATCH /api/sessions/[id]/rename`, target v0.28.0, is still present at 0.29.0 in both modes.*
It is now owner-only, so it is no longer a hole — it is debt with a date on it.

### Verification

`tsc --noEmit` exit 0 · full suite **506 files / 6627 passed / 2 skipped**, exit 0 · both neuters
run and independently attributed · the authentication-only ledger in
`tests/unit/agent-route-authorization-coverage.test.ts` SHRINKS by one, which is the only direction
it may move without a deliberate edit — and is the ledger this card was found by draining. That
ledger's own comment records a prior author fixing a route and forgetting to re-run it; re-running
it is how this commit learned it had to update it.

No advisor verdict was obtained: the Fable weekly window measured `exhausted` (100%), which the
advisor policy names as a sanctioned skip.
