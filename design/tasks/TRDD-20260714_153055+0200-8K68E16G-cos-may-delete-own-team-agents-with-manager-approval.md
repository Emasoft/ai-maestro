---
trdd-id: 8K68E16G
title: A CHIEF-OF-STAFF may delete agents of its own team with MANAGER approval
column: blocked
created: 2026-07-14T15:30:55+0200
updated: 2026-07-14T17:05:00+0200
current-owner: claude-opus-session
created-by: maestro
task-type: feature
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-14T15:30:55+0200
priority: 1
severity: medium
effort: medium
release-via: none
relevant-rules: [6, 10, 28, 29, 30, 32]
labels: [governance, agents, lifecycle, chief-of-staff, authorization]
blocked-by: [F1SL03CK]
pre-block-column: planned
---

# A CHIEF-OF-STAFF may delete agents of its own team with MANAGER approval

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**This is a USER MANDATE — it is already approved. Do not file it for approval; execute it.**

> **Frontmatter correction (2026-07-14):** `column:` was `planned` while `blocked-by:` named a
> live blocker — the corpus linter rejected it, correctly. A card that cannot proceed must SAY
> so in the one field every board query reads: a `planned` card is *available to start*, and
> this one is not. `pre-block-column: planned` was already set, so restoring it when F1SL03CK
> lands is a one-field edit. Being approved and being unblocked are independent — a mandate is
> born approved and can still be waiting on its prerequisite.

It is BLOCKED on `TRDD-F1SL03CK` for a reason of substance, not sequencing: F1SL03CK builds
the *approval mechanism* this rule depends on. Granting COS a delete power before the
"ask the MANAGER first" half exists would ship the power without its condition.

- **NEXT ACTION:** land F1SL03CK (the `authorize('create-agent')` title gate + the
  `OPERATIONS_REQUIRING_TOKEN` mandate gate). Then extend the same two gates to deletion, per
  the design below.

## The USER's ruling (verbatim, 2026-07-14)

> *"a MANAGER must be able to delete an agent. even if soft-deleting it (moving it to the
> cemetery, so it will be restorable), but it should be able to. otherwise the manager would
> not be able to create and delete agents on demand when the need for one arises, and removing
> it afterward. the same for the Chief-of-staff."*
>
> *"the COS can, but it must ask the MANAGER for approval first. and only delete the agents of
> its own team of course."*

## Problem

**A CHIEF-OF-STAFF cannot delete an agent at all.** `lib/authorization.ts`:

```ts
// ── Special rule: delete-agent ──────────────────────────────
// Only system-owner and MANAGER can delete agents.
// No agent can delete itself via API. COS cannot delete.
if (action === 'delete-agent') {
  if (targetAgentId && targetAgentId === auth.agentId) {
    return { allowed: false, reason: 'No agent can delete itself via API' }
  }
  if (title === 'manager') return { allowed: true }
  return { allowed: false, reason: 'Only MANAGER can delete agents' }
}
```

This contradicts what the COS role *is*. The fleet org-chart defines
`ai-maestro-chief-of-staff` as **"per-team agent management; the SOLE entry point into a team
(R6)"**, and R30 gives the COS a mandated power to *create* the agents of its team. A role
whose job is managing a team's agents, and which may create them, cannot remove them — so a
team accumulates every agent it ever needed, and the only way to clean up is to interrupt the
MANAGER.

**Why the denial is a GAP, not a decision.** R30 governs COS agent *creation* (mandate
required). It is **silent on deletion**. The code filled that silence with a hard `false` and
a comment asserting the silence was a policy. That is the same shape as the
`agent_policy_undefined` incident (TRDD-K2WJH7RF): an undecided question, hard-coded as a
refusal, and then read by everyone downstream as settled law.

## The ruling, stated as a rule

**A COS may delete an agent iff ALL of:**

1. the target agent is a **member of the COS's own team** (`team.agentIds.includes(target)`);
2. the COS holds a **MANAGER approval/mandate** for the deletion; and
3. the target is **not the COS itself** (the existing self-delete ban is unconditional and
   stays — an agent may never delete itself via API).

This is the **exact mirror of R30.1 for creation** ("the COS requires the MANAGER's
approval/mandate to create agents"), plus the team-scoping the USER made explicit. Symmetry is
the point: the authority to add and the authority to remove should be governed the same way, or
the asymmetry itself becomes the bug.

**Deletion means SOFT delete.** The default `DeleteAgent` path archives the agent to
`~/.aimaestro/cemetery/<name>-export-<ts>.zip` (gate G03) before cleanup and leaves a registry
tombstone, so it is restorable via `/api/agents/cemetery`. A COS gets **soft delete only** —
`?hard=true` stays MANAGER/owner. The USER named restorability as the reason the power is safe
to grant; a hard delete would remove exactly that.

## What "asks the MANAGER for approval" means mechanically

**It is a portfolio token (R28), not a message.** This is the same "mandate" R30.1 already
names for creation, and it is why this TRDD is blocked on F1SL03CK rather than merely ordered
after it:

- MANAGER mints a token, scope **`agent:delete`**, into the COS's enclave (`canIssue`,
  `lib/portfolio-issue-guard.ts`), host-signed and R34 ledger-anchored.
- The token SHOULD bind its team (and MAY bind a specific target agent), so a mandate to prune
  one team cannot be replayed against another.
- `OPERATIONS_REQUIRING_TOKEN` gains `DeleteAgent: 'agent:delete'`.
- Because the token is verifiable (`GET …/portfolio/verify`, `7d6a9e31`), "the MANAGER approved
  this" stops being a claim in a log line and becomes something the server checks.

**An AMP message must NOT be the approval.** A message is prose: unsigned, unbounded,
unverifiable, and forgeable by anything that can write to an inbox. Approval that gates a
destructive operation has to be an artifact the server can vouch for — which is precisely what
R28 exists for and what #47 ask 2 delivered.

## Proposed change

1. **`lib/authorization.ts`** — replace the `delete-agent` denial with:
   - `title === 'manager'` → allow (unchanged);
   - `title === 'chief-of-staff'` **and** target ∈ the COS's own team → allow, *subject to the
     mandate gate below*;
   - self → deny (unchanged, unconditional);
   - else → deny.
2. **`lib/portfolio-check.ts`** — add `DeleteAgent: 'agent:delete'` to
   `OPERATIONS_REQUIRING_TOKEN` (alongside F1SL03CK's create entries).
3. **`services/element-management-service.ts::DeleteAgent`** — call `matchPortfolioToken(ctx,
   'DeleteAgent', targetAgentId)`; a MANAGER caller short-circuits (R29 self-empowerment), a
   COS must present a valid, unexpired, unrevoked, team-bound token.
4. **`?hard=true` remains MANAGER/system-owner only** — a COS's grant is soft-delete only.
5. **`docs/GOVERNANCE-RULES.md`** — extend **R30** with the deletion clause (IRON, USER-set),
   so the rule and the code say the same thing. R30's current silence on deletion is what let
   the code invent a policy.

## Verification

- A COS **without** a token deleting an own-team agent → **403** (R30.1 mirror).
- A COS **with** a valid `agent:delete` token deleting an own-team agent → **200**, agent lands
  in the cemetery, and is restorable.
- A COS with a valid token deleting an agent of **another** team → **403** (team scoping).
- A COS deleting **itself**, token or not → **403** (unconditional self-ban).
- A COS with an **expired / revoked / other-team** token → **403** (the verifier's negative
  cases, already covered by `tests/unit/portfolio-verify.test.ts`).
- A MANAGER → **200** with no token (unchanged).
- `?hard=true` from a COS → **403**.

## Estimated risk

**MEDIUM.** It grants a destructive power to a title that does not have one. Three things hold
the risk down: the deletion is **soft** (cemetery archive written before cleanup, restorable),
it is **team-scoped**, and it requires a **host-signed, ledger-anchored, revocable** mandate
that did not exist a day ago. The real risk is shipping the *power* before the *condition* —
which is exactly what `blocked-by: F1SL03CK` prevents.

## Approval log

- 2026-07-14T15:30:55+0200 — MANDATE issued by USER (maestro) (min-approval-requirement: user).
  Pre-approved: the issuer is the only authority above the tier floor. No approval request was
  sent. Verbatim ruling quoted above.
