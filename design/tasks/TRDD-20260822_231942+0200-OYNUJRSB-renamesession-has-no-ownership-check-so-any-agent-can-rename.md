---
trdd-id: OYNUJRSB
title: renameSession has no ownership check so any agent can rename any agent's session
column: todo
created: 2026-08-22T23:19:42+0200
updated: 2026-08-22T23:19:42+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T23:19:42+0200
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

- [ ] the policy is RULED between system-owner-only and an ownership check, with the reason
      recorded here — not chosen implicitly by whichever is easier to code
- [ ] if a new `authorize()` action is proposed instead, it is escalated as a governance-vocabulary
      change and NOT added quietly
- [ ] the ruling is applied in BOTH `app/api/sessions/[id]/rename/route.ts` AND
      `services/headless-router.ts` in ONE commit
- [ ] pinned by a test in each mode, and each neuter reddens only its own test (line-anchored)
- [ ] the refusal asserts the REASON, and proves `renameSession` was never reached
- [ ] a positive control shows the permitted caller still renames

## Approval log
