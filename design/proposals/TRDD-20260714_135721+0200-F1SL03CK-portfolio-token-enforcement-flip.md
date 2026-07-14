---
trdd-id: F1SL03CK
title: Decide whether a portfolio token becomes MANDATORY for CreateAgent and CreateTeam
column: proposal
created: 2026-07-14T13:57:21+0200
updated: 2026-07-14T13:57:21+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: security
min-approval-requirement: manager
approved: false
priority: 0
severity: high
effort: medium
release-via: none
relevant-rules: [28, 29, 30, 31, 32, 34, 41]
labels: [governance, security, portfolio, enforcement]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/47]
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

## Approval log
