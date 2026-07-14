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
priority: 2
severity: medium
effort: small
release-via: none
relevant-rules: [28, 29, 30, 32, 34, 41]
labels: [governance, security, portfolio, enforcement]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/47]
---

# Decide whether a portfolio token becomes MANDATORY for CreateAgent and CreateTeam

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**This is a DECISION, not an implementation task.** The code already exists, is tested, and
is switched off. Nothing here needs to be built; something here needs to be *chosen*.

- **Current state:** `OPERATIONS_REQUIRING_TOKEN` in `lib/portfolio-check.ts` is `{}`. The
  third authorization check (R28) therefore always passes. `CreateTeam`
  (`services/teams-service.ts:305`) and `CreateAgent`
  (`services/element-management-service.ts:6903`) already CALL `matchPortfolioToken`; it
  returns `ok: true` because the map is empty.
- **NEXT ACTION:** the MANAGER (or the USER) decides yes/no on the v1 set below. If yes, the
  change is three lines and a test; if no, this TRDD is refused and the map's emptiness
  becomes a recorded decision rather than an accident.
- **Do NOT** flip the map as part of some other piece of work.

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

## The question the decision actually turns on

**Does a COS ever create an agent as part of normal team operation?** Two honest answers:

- **Yes** → flipping this breaks a working flow, and the flip must be preceded by the MANAGER
  minting standing `agent:create` mandates to each COS (30-day TTL, revocable). That is real
  operational work, not a config change, and it should be scheduled rather than discovered.
- **No** → the flip is nearly free, and it closes a real gap: a compromised or confused COS can
  currently create agents with no authority beyond its title.

**I do not know which is true**, and I am not going to guess at it inside a security flip. The
MANAGER does know, or can find out in one query. That asymmetry is the reason this is a
proposal and not a commit.

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
