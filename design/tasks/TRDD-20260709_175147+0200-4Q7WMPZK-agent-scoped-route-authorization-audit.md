---
trdd-id: 4Q7WMPZK
title: Audit the ten agent-scoped mutation routes that authorize nothing
column: dev
created: 2026-07-09T17:51:47+0200
updated: 2026-07-09T19:12:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
approval-tier: 0
task-type: security
release-via: none
parent-trdd: TRDD-D3RP7KQZ
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [authorization, audit, agent-routes]
test-requirements: [unit]
audit-requirements: []
review-requirements: []
runtime-targets: [macos, linux]
impacts: []
attempts: 0
implementation-commits: []
external-refs: []
---

# TRDD-4Q7WMPZK — the ten agent-scoped routes that authorize nothing

Derived (EHT) from TRDD-D3RP7KQZ. Tier 0: in-scope, own repo, tightening only.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**1 of 10 reviewed and fixed. Nine remain.** Severity raised MEDIUM → HIGH: the
first route audited turned out to be a live fleet-wide denial-of-governance, not
a paperwork gap.

**FIXED — `DELETE /api/agents/[id]/queue/[entryId]`.** It called `requireAuth`
alone. Enqueue is gated (MANAGER anywhere, COS in-team, an agent on itself);
cancel was gated by *nothing*, and the sibling `GET` hands any authenticated
caller the entry ids. So one valid agent token could silently delete every
command a MANAGER had queued across every agent — and an agent could veto an
order queued for itself. The POST gate protected nothing: you could not inject,
but you could nullify, which lands in the same place.

The fix is two checks, because there are two attacks (see the route's doc
comment): cross-agent goes through the `send-command` matrix; self-target needs
ownership, because `send-command` alone would ALLOW it — self-drive is exempt per
D3RP7KQZ. Driving your own terminal is permitted; refusing an order is not. So
`CommandQueueEntry` grew an `enqueuedBy` recorded from the *verified* auth result
(never the body), and an entry with no `enqueuedBy` is not yours (fail closed).

Falsified before it was believed: with the guard removed, exactly the seven
refusal assertions fail and the seven permissive ones still pass.

**NEXT ACTION:** audit the nine remaining routes in `UNREVIEWED_INVENTORY`
(`tests/unit/agent-route-authorization-coverage.test.ts`), in this order — the
mutating ones first: `subconscious`, `metadata`, `metrics`, `element-inventory`,
`amp-init`, `chat`, `export`, `messages/[messageId]`, `email/addresses/[address]`.

**Load-bearing facts.**
- `requireAuth` / `enforceAuth` AUTHENTICATE only. Neither authorizes. Treating
  "non-strict" as "no authorization needed" is what produced this bug; non-strict
  is a statement about the *sudo* gate and nothing else.
- The open `GET .../queue` is retained (a documented fleet-monitor surface, like
  `/full` and `/prompt`). It was the reconnaissance half of the exploit; with
  cancel authorized, knowing an entry id buys nothing. Revisit if that changes.

**SUPERSEDED — do NOT carry forward.** The coverage ledger's note that
`queue/[entryId]` is "a governance-evasion question, not an oversight, recorded
rather than silently changed" — it was both, and it is now decided and fixed.

## Problem

TRDD-D3RP7KQZ set the invariant — an agent may drive its own surface, never
reconfigure itself — and enforced it in `authorize()`. A route that never CALLS
`authorize()` is not covered by it.

`POST /api/agents/[id]/install-skills` was exactly that. It called `enforceAuth`,
which AUTHENTICATES and stops: it proves who the caller is and says nothing about
what they may do. Any authenticated agent could install the skill set onto any
non-Claude agent, itself included. Fixed in `11cd98a6`.

It was found by hand. The guardrail added alongside the fix
(`tests/unit/agent-route-authorization-coverage.test.ts`) now pins TEN more
agent-scoped mutating routes with no authorization step. That list is a record of
what NOBODY HAS REVIEWED — not a list judged safe.

## The ten

| Route (under `app/api/agents/[id]/`) | Verbs | First read |
|---|---|---|
| `amp-init/` | POST | mints an AMP identity for the agent |
| `chat/` | POST | probably fine — a message, not a config change |
| `element-inventory/` | POST | POST-shaped read? confirm |
| `email/addresses/[address]/` | PATCH, DELETE | its SIBLING `addresses/route.ts` DOES authorize — asymmetry is the tell |
| `export/` | POST | exports agent state; a read that writes a file |
| `messages/[messageId]/` | PATCH, DELETE, POST | mailbox mutation |
| `metadata/` | PATCH, DELETE | registry-adjacent; likely needs `modify-agent` |
| `metrics/` | PATCH | probably fine — telemetry is not reconfiguration |
| `queue/[entryId]/` | DELETE | see below — the interesting one |
| `subconscious/` | POST | starts/stops the agent's subconscious |

## `queue/[entryId]` DELETE is a decision, not an oversight

Its own comment states the policy deliberately:

> Non-strict (requireAuth only): cancelling is a DE-escalation — it REMOVES a
> pending action rather than injecting one — so it needs no sudo token. Any
> authenticated caller may cancel a queued entry.

The de-escalation argument is sound for the SUDO gate and wrong for the
AUTHORIZATION gate. As written, any authenticated agent may cancel any other
agent's queued commands — including a `/compact` its own CHIEF-OF-STAFF queued
for it. An agent cannot remove itself from governance via the API, but it can
quietly discard governance's instructions.

That is a governance-evasion question. It was recorded rather than silently
changed, because reversing a documented, deliberate decision is not a Tier-0 act.
It probably wants `send-command` semantics (self allowed — cancelling your own
`/compact` is fine; another agent's requires MANAGER, or COS in team).

## Scope

For each of the ten: read it, decide GUARDED (add the authorization step and the
right action/target) or EXEMPT (declare why — a metrics PATCH is not a
reconfiguration), and shrink `UNREVIEWED_INVENTORY` accordingly. The guardrail's
second test fails if a route is fixed but left in the ledger, so the list cannot
drift in either direction.

Two routes outside `[id]/` are body-targeted and therefore outside the
guardrail's reach, but belong to the same audit:
`role-plugins/inject-skill` and `role-plugins/sync-defaults` — both mutate role
plugins, which the invariant says only MANAGER/COS/USER may do, and neither calls
`authorize()`.

## Verification

- The guardrail's `UNREVIEWED_INVENTORY` shrinks to exactly the routes decided
  EXEMPT, each with a one-line reason at its entry.
- Each newly guarded route gets a test at the `authorize()` boundary (self denied
  for configuration; MANAGER/COS-own-team allowed) rather than a route-level mock.
- `queue/[entryId]` DELETE's outcome is recorded in this TRDD either way.

## Estimated risk

LOW-MEDIUM. Every change tightens. The risk is breaking a UI path that relied on
an unauthenticated-in-practice route; the system-owner (web UI) is granted by
`authorize()` outright, so a UI regression would mean the UI was calling the
route AS an agent, which is itself worth knowing.

## Notes and lessons learned

Fail-closed is worth little if nothing tells you a door was never fitted. The
strict-route ledger (TRDD-6A2I6ZO0) and this one are the same idea applied twice:
make the absence of a decision fail a test, because the absence of a decision does
not fail anything on its own.
