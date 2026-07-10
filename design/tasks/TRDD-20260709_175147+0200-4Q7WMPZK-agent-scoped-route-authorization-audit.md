---
trdd-id: 4Q7WMPZK
title: Audit the ten agent-scoped mutation routes that authorize nothing
column: dev
created: 2026-07-09T17:51:47+0200
updated: 2026-07-10T02:41:00+0200
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
implementation-commits: [c7d9f8a7, 4b1a9b48, 28593ed7, 6c905104, 505ae8c9, 1ad04ade, c8903197, 2fd32899, 03159944]
external-refs: []
---

# TRDD-4Q7WMPZK — the ten agent-scoped routes that authorize nothing

Derived (EHT) from TRDD-D3RP7KQZ. Tier 0: in-scope, own repo, tightening only.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**All ten triaged. 8 fixed, 1 is a detector artifact, 1 needs a decision
(`amp-init`).** Severity raised MEDIUM → **CRITICAL**: this was never a paperwork
gap. The second route audited (`chat` POST) is a full bypass of the `send-command`
matrix AND of sudo-mode, reachable by any agent, through the one endpoint nobody
thought of as a control surface because it is called "chat".

**Every route this audit's own table triaged from a NAME was wrong** — five for
five in the YEE33F3A half, in severity, in verb, or in the proposed action. Twice
(`element-inventory`, `metrics`) the proposed `modify-agent` would have denied the
endpoint's only intended caller. `UNREVIEWED_INVENTORY` is now `[amp-init,
metadata]`; deciding `amp-init` empties it and closes this TRDD.

### Triage table (verified 2026-07-09 by reading each route + its service)

| Route (agent-scoped) | Verbs | Guard today | What a caller can do | Verdict |
|---|---|---|---|---|
| `chat` | POST | ~~`enforceAuth`~~ → **`authorize('send-command')`** | `sendKeys(literal, enter)` into ANY pane | **FIXED** `c7d9f8a7` |
| `queue/[entryId]` | DELETE | ~~`requireAuth`~~ → **ownership + matrix** | delete any queued command, fleet-wide | **FIXED** `4b1a9b48` |
| `metadata` | PATCH DELETE | `ChangeMetadata` G00 | — | detector artifact, authorized |
| `amp-init` | POST | hand-rolled `isManager` | re-mint AMP keys; **self allowed** | needs a decision, not a fix |
| `export` | POST | `enforceAuth` | export ANY agent's full transcripts | **OPEN — confidentiality** |
| `messages/[messageId]` | PATCH DELETE POST | ~~`authenticateFromRequest`, unused~~ → **mailbox ownership** | POST forwarded AS any agent (sender forgery + arbitrary mailbox read); PATCH/DELETE mutated any mailbox | **FIXED** `28593ed7` |
| `email/addresses/[address]` | PATCH DELETE | ~~`enforceAuth`~~ → **`authorize('modify-agent')`** | mutate ANY agent's address book | **FIXED** `6c905104` |
| `subconscious` | ~~POST~~ GET | ~~`enforceAuth`~~ → **POST DELETED; GET ownership** | POST drove NOTHING (400 for every input, 0 callers); GET had no auth and `getAgent()` constructs+evicts | **FIXED** `505ae8c9` + `03159944` |
| `element-inventory` | POST | ~~`enforceAuth`~~ → **ledger ownership** | append forged snapshots to ANY agent's audit ledger | **FIXED** `1ad04ade` |
| `metrics` | PATCH | ~~`enforceAuth`~~ → **ownership + input validation** | rewrite ANY agent's metrics; inject arbitrary registry keys; store a string into `estimatedCost` and crash that agent's profile tab | **FIXED** `c8903197` |

`enforceAuth` returns `NextResponse | null`. It authenticates and **discards the
auth result** — the route never learns who the caller is, so it *cannot* authorize
even if it wanted to. Every route above using it is unauthorized by construction.

### Which of the six is a mapping, and which is a policy call

Fixing `chat` needed no decision: the route *is* `send-command`, and the openly
named twin (`PATCH …/session`) already carries that action.

`email/addresses/[address]` needed no decision either, but NOT for the reason
first assumed. The plan was to wire the `manage-amp-address` action, which exists
for exactly this. Reading the code first showed the three siblings —
`email/addresses` POST, `amp/addresses` POST, `amp/addresses/[address]`
PATCH+DELETE — all authorize with **`modify-agent`**. Wiring `manage-amp-address`
into the fourth would have created a split-brain: two actions for one capability.
Matching the siblings is a consistency fix; changing all four to
`manage-amp-address` would be a policy call. Only caller is the dashboard UI
(`components/EmailAddressesSection.tsx`), so no self-claim flow breaks.

**`manage-amp-address` is DEAD.** Declared in the `AuthAction` union (SVC2-MAJ-18)
and asserted in `tests/authorization.test.ts`'s SELF_FORBIDDEN list, but wired to
zero routes. Either the four address routes should adopt it, or it should be
deleted. That is a decision, not a cleanup — it belongs in the proposal below.

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

### The guardrail was keyed on a PATH; capabilities are not paths

Applying the `chat` lesson (enumerate by the dangerous PRIMITIVE, not the path)
across the whole `app/api` surface found **two more** unauthorized routes that the
agent-scoped guardrail structurally could not see:

- `sessions/[id]/rename` PATCH → `renameSession` (registry + tmux write).
  `modify-agent` likely fits, but the path carries a SESSION id, so the target
  agent must be resolved via `getAgentBySession` first — more than a mapping.
- `sessions/restore` POST+DELETE → `restoreSessions` (spawns tmux). The
  `create-session` action already exists and is documented as exactly this
  primitive.

New guardrail: `tests/unit/dangerous-primitive-authorization.test.ts`, keyed on
the primitive, covering ALL of `app/api`. Falsified with a probe route — it fails
loud on any new unauthorized primitive-reaching route.

**Do NOT read `96 of 165 mutating routes lack authorize()` as 96 holes.** Many are
gated by other means: `governance/manager` verifies the governance password in the
body; `v1/*` uses AMP api-keys and the AID challenge; `auth/*` is pre-auth by
nature. The 96 is a *detection* gap, not a vulnerability count.

**But `middleware.ts` is only a structural credential-PRESENCE check** — it does
not verify the token, does not distinguish an agent from a human, and never
authorizes. So any holder of a valid `aim_tk_` reaches every route that does not
authorize for itself. That is why "the middleware protects it" is never an answer.

**Assessed and NOT a hole:** `sessions/activity/update` POST (`enforceAuth` only)
can be forged by any authenticated caller to fake an `idle_prompt` and force a
queue drain. But `drainCommandQueueForSession` independently calls
`evaluateExitGate(readSubagentCount(...))` and resolves `commandKey` against the
allowlist, so a forged event cannot inject arbitrary text nor run while subagents
are provably alive. Residual impact is mid-turn timing of an ALREADY-authorized
command, plus status spoofing to dashboard clients. MEDIUM, recorded not fixed.

**NEXT ACTION:** none in this TRDD — the Tier-0 work is done (`03159944` closed
the last of it: the construct-on-read the route-shaped audit had missed).
Everything left is policy and is carried by **TRDD-YEE33F3A**
(`design/proposals/`, tier 2, awaiting the USER or MANAGER): the five routes
needing new AuthActions, the `amp-init` self-remint question, and the dead
`manage-amp-address` action. Do NOT invent those actions here.

**SUPERSEDED — do NOT carry forward.** An earlier revision of this line said "the
Tier-0 work is done" while `getSubconsciousStatus`, `getSkillSettings`, and
`saveSkillSettings` were all still calling the constructing accessor. Fixing a
route's AUTH does not fix the primitive the route reaches.

This TRDD closes when YEE33F3A is decided and its fixes land — at which point
`UNREVIEWED_INVENTORY` reaches `[]` and the coverage guardrail alone keeps the
surface honest.

### The construct-on-read had spread past the route this audit found it on

`505ae8c9` authorized the subconscious GET but left the primitive it guarded:
`agentRegistry.getAgent()` is a **get-or-CREATE**. It never returns null; it
`evictIfNeeded()`s (shutting down the LRU real Agent at the cap of 10), then
constructs and `initialize()`s an Agent for any id — `cerebellum.start()` →
subconscious `start()` → a config-change timer, a hostHints subscription, and an
`mkdir` + `status.json` write under `~/.aimaestro/agents/<id>/`.

Auditing by ROUTE could not see that the same call sat in **two more services**.
Fixed in `03159944`:

| Caller | Used the returned Agent? | Wanted | Now |
|---|---|---|---|
| `agent-startup.ts` | no — initializes it | the construct | unchanged (its ids are disk ∩ registry) |
| `getSubconsciousStatus` | yes → `getSubconscious()` | a runtime read | file registry for existence + `getExistingAgent` for liveness |
| `getSkillSettings` / `saveSkillSettings` | **never touched it** | an existence check | the file-registry `getAgent()` the siblings already used |

Three lessons, each a rerun of one this audit already learned:

- **A read accessor already existed** (`getExistingAgent`, Map.get + LRU touch).
  Nothing had to be designed. The bug was never a missing capability.
- **The comments described the intent, not the code.** NT-008 annotated the
  skills call as needed "for runtime operations (subconscious access)" — those
  functions never call `getSubconscious()`. SF-037 then wrote 20 lines of test
  scaffolding explaining why two agent-lookup mocks were required and how
  forgetting one caused "silent test failures". Both existed to serve a call that
  did nothing. Deleted with it.
- **`if (!agent) return 404` was dead in all three.** In skills that meant an
  unknown or soft-deleted agent got a 200. The 404 is live for the first time.

The sharpest version: `AgentSubconsciousIndicator` polls `GET …/subconscious`
every 30s for the viewed agent. The endpoint that REPORTS whether a subconscious
is running was the thing STARTING it, and evicting somebody else's to do it.
`exists: true` / `initialized: true` were hardcoded because after the construct
they could not have been anything else — a tautology dressed as a status field.

**Load-bearing facts.**
- `agentRegistry.getAgent()` (in-memory, `lib/agent.ts`) is get-or-CREATE and
  never returns null. `getAgent()` (file registry, `lib/agent-registry.ts`) is a
  read and returns `Agent | null`. Same name, opposite contracts, both in scope in
  the same module. Existence questions belong to the file registry — it is the
  source of truth, and an agent exists whether or not it is loaded.
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
