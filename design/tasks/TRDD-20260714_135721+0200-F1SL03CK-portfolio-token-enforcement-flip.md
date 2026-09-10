---
trdd-id: F1SL03CK
title: Decide whether a portfolio token becomes MANDATORY for CreateAgent and CreateTeam
column: planned
created: 2026-07-14T13:57:21+0200
updated: 2026-09-10T13:57:54+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: security
min-approval-requirement: manager
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:59:38+0200
priority: 0
severity: high
effort: medium
release-via: none
relevant-rules: [28, 29, 30, 31, 32, 34, 41]
labels: [governance, security, portfolio, enforcement]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/47]
assignee: ai-maestro-hub-session
implementation-commits: [b5e12d46934407918233da9c507a72857c101af3]
---

# Decide whether a portfolio token becomes MANDATORY for CreateAgent and CreateTeam

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14 (REVISED)

**⚠ THE BODY BELOW IS SUPERSEDED IN ITS FRAMING.** It calls this a "governance decision" whose
answer is unknown. That was wrong on both counts, and the correction raises the severity:

1. **The open question is ANSWERED, and it was already answered when I asked it.** The body
   asks *"does a COS ever create an agent in normal team operation?"* and says "I do not know
   which is true." **R30.2 (IRON, USER-set) says yes** — a team-creation mandate authorizes the
   COS to create the 5 base members plus specialized MEMBERs. That IS normal team operation.
   I reasoned about what the MANAGER *would* have to tell me instead of reading the rule that
   already said it. (Sixth instance of [[agent-claims-the-api-was-never-delivered]] — the
   answer was on disk.)
2. **This is not an optional hardening. It is the MISSING ENFORCEMENT OF AN IRON RULE.**
   **R30.1: "The CHIEF-OF-STAFF requires the MANAGER's approval/mandate to create agents."**
   There is no mandate check anywhere: `OPERATIONS_REQUIRING_TOKEN` is `{}`, so
   `matchPortfolioToken` returns `ok:true` unconditionally. R30.1 is law with no enforcement.
3. **And it is worse than R30.1 alone.** `POST /api/agents` (`app/api/agents/route.ts`) calls
   `authenticateFromRequest` and **NOTHING ELSE** — no `authorize()`, no title check. There is
   no `create-agent` AuthAction in the RBAC enum at all, and the route is absent from
   `security-registry.json`. So **any authenticated agent of any title can create agents.**
   The comment above the auth call reads *"CC-GOV-008: Auth required — agent creation is a
   privileged mutation"* — it names the operation privileged and then checks only WHO the
   caller is, never WHETHER they may. Authentication standing in for authorization.

- **NEXT ACTION:** flip the map to the v1 set AND add the missing authorize() gate on
  creation. The token gate alone is not sufficient — it enforces "has a mandate", not
  "is allowed to hold one".
- **Severity raised** to `high`, task-type to `security`. This is a fix, not a proposal.
- **Still do NOT flip it silently as part of other work** — but it now needs to be scheduled,
  not merely considered.

## Problem

Enabling an operation in `OPERATIONS_REQUIRING_TOKEN` is a **one-line diff with a fleet-wide
blast radius**. It is the difference between "a COS may create an agent" and "a COS may create
an agent *only if a MANAGER minted it a token saying so*". That is a governance change wearing
the clothes of a refactor, and its own source header says so:

```ts
// lib/portfolio-check.ts:33
// SHIPPED EMPTY (D2) — enabling an op here is the only behavior change
export const OPERATIONS_REQUIRING_TOKEN: Record<string, string> = {}
```

ai-maestro#47 asked for **verification** — that an agent be able to check whether a mandate is
authentic. That is delivered (`7d6a9e31`, `1e0cbad4`). It did **not** ask for **enforcement**,
and the two are genuinely different: verification lets an agent *refuse* to act on a forgery;
enforcement makes the *server* refuse. Shipping the second under cover of the first would be
exactly the mistake this whole week has been about — a capability turned on because it was
adjacent to the work, not because someone decided.

So the flip is proposed here, alone, where it can be said yes or no to.

## Proposed change (the v1 set)

```ts
export const OPERATIONS_REQUIRING_TOKEN: Record<string, string> = {
  CreateAgent: 'agent:create',
  CreateTeam:  'team:create',
}
```

Deliberately narrow — only the two operations R28–R31 actually reason about. Not a general
"gate everything" switch.

## What it would actually change

**Unaffected:** the USER / system-owner (they are the mint authority), and the MANAGER (R29
self-empowerment bypass — it is the issuer of its own authority). Both short-circuit before the
token lookup.

**Affected:** a **CHIEF-OF-STAFF** creating an agent, and any delegated caller creating a team.
Today they can. Afterwards they must first hold a valid, host-signed, **ledger-anchored** token
minted by a MANAGER (`canIssue`, `lib/portfolio-issue-guard.ts`).

That is the whole point — and it is also the whole risk. If any routine COS flow creates agents
today without a mandate, this turns it into a 403 the moment it ships.

## The question the decision turns on — ANSWERED (2026-07-14)

**Does a COS ever create an agent as part of normal team operation?** — **YES.** R30.2 (IRON,
USER-set): a team-creation mandate authorizes the COS to create the 5 basic members plus
specialized MEMBER agents tailored to the project. That is the COS's defining job; the fleet
org-chart calls the role *"per-team agent management"*.

So the "Yes" branch below is the live one, and it says exactly what must happen:

> flipping this breaks a working flow, and the flip must be preceded by the MANAGER minting
> standing `agent:create` mandates to each COS (30-day TTL, revocable). That is real
> operational work, not a config change, and it should be scheduled rather than discovered.

**But the framing was still wrong.** I wrote "I do not know which is true, and the MANAGER can
find out in one query." The answer was not in the MANAGER's head — it was in R30.2, in the
repo, written by the USER. The correct move was to read the governance rules before declaring
the question unanswerable. Recorded as a lesson, not just a correction.

## The bigger hole this surfaced: creation has NO authorization at all

The token gate is the *second* missing check. The first is that there is no check.

```ts
// app/api/agents/route.ts — the COMPLETE authorization of agent creation
// CC-GOV-008: Auth required — agent creation is a privileged mutation
const auth = authenticateFromRequest(request)
if (auth.error) return NextResponse.json({ error: auth.error }, { status: 401 })
// … validate body … then straight into CreateAgent(). No authorize(). No title check.
```

- No `create-agent` AuthAction exists in `lib/authorization.ts`'s enum (`modify-agent`,
  `delete-agent`, `manage-team` — but nothing for create).
- `POST /api/agents` is absent from `security-registry.json`, so it is not `strict` either.
- `CreateAgent`'s `matchPortfolioToken` call is the only authority gate in the path, and it is
  disarmed.

**Therefore any authenticated agent — a MEMBER, an ORCHESTRATOR, anyone with an AID — can
create agents today.** R29.3 reserves AUTONOMOUS/MAINTAINER creation to the MANAGER; R30.1
requires a MANAGER mandate for a COS. Neither is enforced by anything.

Flipping `OPERATIONS_REQUIRING_TOKEN` enforces *"you hold a mandate"*. It does **not** enforce
*"you are entitled to hold one"* — a MEMBER handed a token would pass. Both checks are needed:

1. **`authorize('create-agent', …)`** — a title gate: MANAGER always; COS only for its own
   team; everyone else denied. (Add the AuthAction; add the route to the strict registry so
   the USER path gets a sudo modal and the agent path gets the R28 three-check per R32.3.)
2. **`OPERATIONS_REQUIRING_TOKEN = { CreateAgent: 'agent:create', CreateTeam: 'team:create' }`**
   — the mandate gate, enforcing R30.1's "unless the MANAGER granted a team-creation mandate".

Ship them together. Either alone is a half-gate that reads as a whole one.

## Verification (if approved)

1. Flip the map.
2. `tests/unit/portfolio-check.test.ts` already covers both sides (a COS *with* a valid
   ledger-anchored mandate → granted; *without* → denied). Add a service-level test that
   `ChangeTeam`/`CreateAgent` return the 403 with the mint hint.
3. Confirm the MANAGER and system-owner paths still bypass (they have explicit tests).
4. Mint standing mandates to existing COS agents BEFORE deploy if the answer above is "yes".

Reversal is a one-line revert — which is a genuine argument for trying it, and not an argument
for doing it without asking.

## Estimated risk

**MEDIUM.** The code is proven and the revert is trivial, but the blast radius is every COS in
the fleet, and the failure mode is a 403 in a flow someone depends on. Risk is dominated
entirely by the operational question above, not by the code.

## Progress — 2026-08-22T21:34:57+0200 — the AUTHORIZE half is LANDED; the FLIP is the owner's

`c9a25084`. All four STATE-block claims re-derived first (the approval was ~24h old) and all four
were unchanged.

**The NEXT ACTION splits cleanly, and the split comes from this card's own risk section** — *"risk
is dominated entirely by the operational question, not by the code"*:

- **the `authorize()` gate** denies only titles that were never supposed to create agents. MANAGER
  and COS stay allowed, so nothing in the fleet breaks. **Pure hardening — landed.**
- **the `OPERATIONS_REQUIRING_TOKEN` flip** 403s every COS that lacks a minted mandate, and
  verification step 4 requires minting standing mandates to existing COS agents BEFORE deploy — an
  operational act on live agents. **Not done; not mine.**

The STATE block argues the token gate alone is insufficient. It does not argue against the
authorize gate alone, and indeed calls the missing authorize() the worse half (*"and it is worse
than R30.1 alone"*). So landing this half first is faithful to the card, not a shortcut past it.

`register-agent` was NOT reused: it is system-owner ONLY — *"not even MANAGER, because
registerAgent is the bootstrap primitive"* — and its own comment says to use the in-band path
instead. Reusing it would have denied the MANAGER.

## Acceptance

This card carried **ZERO checkboxes** — a priority-0 `severity: high` security card whose
completion gate was therefore vacuous (every box in an empty set is trivially checked). Adding the
gate it should have had:

- [x] a `create-agent` AuthAction exists and its matrix encodes R30.1/R30.2 — MANAGER and COS
      allowed, every other title denied
- [x] `POST /api/agents` calls `authorize()` and returns 403 on denial, BEFORE any creation —
      asserted as `CreateAgent` never called, since "refused after the fact" is not a refusal
- [x] the guard is proven load-bearing by neuter, not by assertion — deleting the matrix rule reds
      3 (MEMBER becomes ALLOWED, COS becomes DENIED); deleting the route gate reds exactly the 2
      denials and leaves both grants green. Both restored byte-identical, `cmp`-verified
- [x] `authorize` is NOT mocked in the route test — mocking a guard to prove the guard is a test
      that survives the guard's deletion
- [x] **`OPERATIONS_REQUIRING_TOKEN` flipped to the v1 set** (`CreateAgent: 'agent:create'`,
      `CreateTeam: 'team:create'`) — landed at `lib/portfolio-check.ts:46-47`, commit
      `b5e12d46934407918233da9c507a72857c101af3`. Map flip ONLY, per the coordinator's narrowed
      scope for the implementation task (the `authorize('create-agent')` title-gate above was
      already landed separately at `c9a25084` and is untouched by this commit). Verified:
      `tsc --noEmit` 0 errors; `tests/unit/portfolio-check.test.ts` +
      `tests/unit/portfolio-verify.test.ts` + `tests/services/portfolio-create-agent-authz.test.ts`
      42/42 passing, including the rewritten no-op/bypass case (neutered: gating a genuinely
      ungated op name reddened exactly that 1 test with the expected assertion error, 14 siblings
      skipped, reverted to green — recorded inline in the test's own docstring).
- [ ] standing `agent:create` mandates minted to existing COS agents BEFORE the flip is deployed
      (verification step 4; the answer to "does a COS create agents in normal operation" is YES per
      R30.2, so this is required, not conditional) — **NOT ATTEMPTED in the F1SL03CK implementation
      task (2026-09-10).** This is owner-side operational work on live agents (minting real
      ledger-anchored mandates to whichever COS agents currently exist in the fleet), explicitly
      out of scope for a code-only implementer per the task's own dispatch. The map flip above is
      now landed in the worktree but **not yet merged/deployed**, so no live COS has been 403'd by
      it yet — this box remains the deploy-blocking gate the STATE block and NEXT ACTION section
      already named. Left open deliberately; not a failure of this task.
- [x] `POST /api/agents` added to `security-registry.json` — classified `strict` at
      `security-registry.json`'s `entries."POST_/api/agents"`, commit
      `b5e12d46934407918233da9c507a72857c101af3`. Landed together with the flip (the route only
      acquires a real strict-path contract once the token check above is active). Classification
      only — no `requireSudoToken()` call was added to `app/api/agents/route.ts`'s POST handler;
      the registry's own Rule 4 claim that "no code change needed" is misleading (confirmed via
      `middleware.ts` and a `security-registry` consumer sweep: `lib/sudo-guard.ts` is the only
      reader, invoked explicitly per-route, not automatically), and a disclosure comment saying so
      was added in the same commit, right above the new entry. Surfaced (and disclosed, not fixed)
      that `services/headless-router.ts`'s independent `POST /api/agents` reimplementation has
      neither an `authorize()`/`decideAidTitle()` call nor delegation to the Next.js route — now
      pinned in `tests/unit/headless-strict-route-authz-coverage.test.ts`'s `neither` snapshot,
      which grew by exactly this one entry as that test's own docstring anticipates.

## NEXT ACTION — one decision for the OWNER

**Flip `OPERATIONS_REQUIRING_TOKEN` to the v1 set, or leave it empty?**

It is a one-line diff and a one-line revert. What makes it the owner's and not mine: at DEPLOY it
403s every COS in the fleet that does not already hold a ledger-anchored `agent:create` mandate, so
it must be sequenced with minting those mandates — an operational act on live agents. The code is
proven (`tests/services/portfolio-create-agent-authz.test.ts` covers both sides); the risk is
entirely operational.

**Landing it while it cannot be deployed is its own hazard** — a breaking change sitting on the
branch that someone else deploys. That is why it is not landed "ready to go".

### Update — 2026-09-10T13:57:54+0200 — the OWNER decision was made; the flip is landed, not deployed

The `## Approval log` below already records the 2026-08-21 APPROVED decision for this exact NEXT
ACTION. A code-only implementation task (this session) then executed it: the map flip landed at
`lib/portfolio-check.ts:46-47` and the registry classification at `security-registry.json`, both
in commit `b5e12d46934407918233da9c507a72857c101af3` on worktree branch
`worktree-agent-a2a0ae9093f41c20f` — **not yet merged into `main`, and not deployed**. The hazard
this section names ("landing it while it cannot be deployed") is therefore still live in the
narrow sense that matters: the code exists on a branch, but **nobody should merge/deploy it until
the still-open acceptance box above (minting standing `agent:create` mandates to existing COS
agents) is done**, which remains explicitly owner-side and was not attempted here.

## Adjacent finding, filed separately as `TRDD-CAVCTULL`

The guard that exists to catch this exact class — a mutating agent route with no authorization —
could not see it, for two independent reasons: its scan root is `app/api/agents/[id]/` only (the
collection subtree, **26 mutating routes, 18 with no authorization step at all**, has never been
under any guard), and its `AUTHORIZES` needle counts `buildAuthContext(` as an authorization step,
which this route already called. A context CONSTRUCTION read as an authorization DECISION — the
same proxy-for-the-thing shape as the bug it missed. Not absorbed here; it is a pre-existing guard
gap this card revealed, not a hole this card opened, so it is an independent card and deliberately
NOT an EHT (a wrong lineage edge is worse than none).

## Approval log

- 2026-08-21T21:59:38+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured every claim in the STATE block: OPERATIONS_REQUIRING_TOKEN is still `{}` (lib/portfolio-check.ts:35), no `create-agent` AuthAction exists in lib/authorization.ts's enum, `POST /api/agents` is still absent from security-registry.json, and app/api/agents/route.ts still gates creation with only authenticateFromRequest — no authorize() call. The gap (any authenticated agent of any title can create agents) is unrepaired. Approving the STATE block's NEXT ACTION as scoped: flip the map to the v1 set AND add the missing authorize() gate together, per R30.1/R30.2/R29.3, plus minting standing agent:create mandates to existing COS agents before deploy.
