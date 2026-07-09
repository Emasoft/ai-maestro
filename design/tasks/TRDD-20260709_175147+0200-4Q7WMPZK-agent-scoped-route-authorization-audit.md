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
implementation-commits: [4b1a9b48, c7d9f8a7]
external-refs: []
---

# TRDD-4Q7WMPZK — the ten agent-scoped routes that authorize nothing

Derived (EHT) from TRDD-D3RP7KQZ. Tier 0: in-scope, own repo, tightening only.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**All ten triaged. 2 fixed, 2 are detector artifacts, 6 remain open.** Severity
raised MEDIUM → **CRITICAL**: this was never a paperwork gap. The second route
audited (`chat` POST) is a full bypass of the `send-command` matrix AND of
sudo-mode, reachable by any agent, through the one endpoint nobody thought of as
a control surface because it is called "chat".

### Triage table (verified 2026-07-09 by reading each route + its service)

| Route (agent-scoped) | Verbs | Guard today | What a caller can do | Verdict |
|---|---|---|---|---|
| `chat` | POST | ~~`enforceAuth`~~ → **`authorize('send-command')`** | `sendKeys(literal, enter)` into ANY pane | **FIXED** `c7d9f8a7` |
| `queue/[entryId]` | DELETE | ~~`requireAuth`~~ → **ownership + matrix** | delete any queued command, fleet-wide | **FIXED** `4b1a9b48` |
| `metadata` | PATCH DELETE | `ChangeMetadata` G00 | — | detector artifact, authorized |
| `amp-init` | POST | hand-rolled `isManager` | re-mint AMP keys; **self allowed** | needs a decision, not a fix |
| `export` | POST | `enforceAuth` | export ANY agent's full transcripts | **OPEN — confidentiality** |
| `messages/[messageId]` | PATCH DELETE POST | `authenticateFromRequest`, unused | delete/edit ANY agent's AMP messages | **OPEN — governance channel** |
| `email/addresses/[address]` | PATCH DELETE | `enforceAuth` | mutate ANY agent's address book | **OPEN** |
| `subconscious` | POST | `enforceAuth` | `triggerSubconsciousAction` on ANY agent | **OPEN** |
| `element-inventory` | POST | `enforceAuth` | writes agent element state | **OPEN** |
| `metrics` | PATCH | `enforceAuth` | `updateMetrics` on ANY agent | **OPEN — low blast radius** |

`enforceAuth` returns `NextResponse | null`. It authenticates and **discards the
auth result** — the route never learns who the caller is, so it *cannot* authorize
even if it wanted to. Every route above using it is unauthorized by construction.

### Which of the six is a mapping, and which is a policy call

Fixing `chat` needed no decision: the route *is* `send-command`, and the openly
named twin (`PATCH …/session`) already carries that action. `email/addresses`
is the same shape — the `manage-amp-address` AuthAction already exists and was
simply never wired (note: wiring it also DENIES an agent its own address, since
`manage-amp-address` is not a self-drive action; confirm that breaks no
`amp-register` flow before landing).

The rest need an action that does not exist yet — reading another agent's
transcripts, deleting its messages, driving its subconscious. Inventing four
AuthActions is policy, so it belongs in a proposal, not in this Tier-0 EHT.

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

**NEXT ACTION:** wire `email/addresses/[address]` PATCH+DELETE to the existing
`manage-amp-address` action (a mapping, Tier 0) — after grepping for a self-claim
caller that the self-target ban would break. Then file ONE proposal covering the
four routes that need new AuthActions (`export`, `messages/[messageId]`,
`subconscious`, `element-inventory`) plus the `amp-init` self-remint question.
Do NOT invent those actions inside this Tier-0 EHT.

**Load-bearing facts.**
- `requireAuth` / `enforceAuth` AUTHENTICATE only. Neither authorizes. Treating
  "non-strict" as "no authorization needed" is what produced this bug; non-strict
  is a statement about the *sudo* gate and nothing else.
- `middleware.ts` is a global authenticate-everything gate ("prevents the 'forgot
  to authenticate' class of bug"). So a route with NO auth call — `chat` GET has
  none — is still authenticated. It is not, and never was, authorized.
- **A capability is defined by what the code does, not by what the route is
  named.** `chat` was `send-command` wearing a friendly name. When auditing, read
  through to the service call, never stop at the endpoint's title.
- The open `GET .../queue` is retained (a documented fleet-monitor surface, like
  `/full` and `/prompt`). It was the reconnaissance half of the exploit; with
  cancel authorized, knowing an entry id buys nothing. Revisit if that changes.
- A test asserting `indexOf(A) < indexOf(B)` passes vacuously when A is absent
  (`-1 < n`). Assert PRESENCE first. Found by falsifying — the ordering test
  passed on the very code it existed to reject.

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
