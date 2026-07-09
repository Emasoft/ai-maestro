---
trdd-id: YEE33F3A
title: Decide the AuthActions for the five remaining unauthorized agent-scoped routes
column: planned
approval-tier: 2
created: 2026-07-09T19:01:42+0200
updated: 2026-07-09T23:34:05+0200
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: M
task-type: security
release-via: none
parent-trdd: TRDD-4Q7WMPZK
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [authorization, agent-routes, authaction, security]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
attempts: 1
implementation-commits: [f56b79f2]
external-refs: []
---

# TRDD-YEE33F3A — the five routes that need an AuthAction that does not exist

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**1 of 5 done, and it was far worse than the body below says.** Severity raised
HIGH → **CRITICAL** while implementing `export`.

### `export` — DONE (`f56b79f2`). Key exfiltration, not confidentiality.

The Part-1 table triages `export` as `POST` / "any agent's FULL conversation
transcripts" / "confidentiality". Both halves are wrong:

- The sharp verb is **GET**, not POST. POST (`createTranscriptExportJob`) has
  **zero callers**; both dashboard dialogs use GET.
- GET streams `exportAgentZip()`, which does
  `archive.directory(getKeysDir(agent.id), 'keys')` — the directory whose
  `private.pem` `lib/amp-keys.ts` annotates **"Agent's private key (NEVER
  shared)"**. Plus `registrations/` (external provider API keys), `agent.db`, and
  every message.

So any agent token could take any other agent's **Ed25519 signing key** and forge
correctly-signed AMP messages as it, forever. The comm-graph gates who may SEND;
nothing gates who may SIGN, because a genuine signature is indistinguishable from
a genuine one.

**Decision** (made under the USER's standing "prioritize security"): new action
`export-agent`, special rule mirroring `register-agent` — **system-owner only,
every agent title denied**, MANAGER and the target's own COS included. MANAGER
governs an agent completely without its key; a COS coordinates a team, it does not
impersonate its members. Self-export denied too: it grants nothing (an agent reads
its own keys off disk today) and would make the API a one-request exfiltration
channel for a compromised agent. Both verbs carry the action; POST having no
callers means the strict side costs nothing. `view-transcript` was deliberately
NOT introduced — add it on purpose if a real self-export flow appears.

`services/headless-router.ts` had the same hole and **no auth call at all**; both
its handlers now call the same `authorize()`, so the two surfaces cannot drift.

### Why the audit missed it — the load-bearing lesson

Both guardrails filter on `export function (POST|PUT|PATCH|DELETE)`. The audit
equated **dangerous** with **mutating**. Exfiltration is a GET. `export` was even
*listed* in the coverage ledger — as an unreviewed POST — which understated it by
a wide margin.

`dangerous-primitive-authorization.test.ts` now carries two classes:
`DANGEROUS_FUNCTIONS` (write/drive, mutating verbs) and `EXFIL_FUNCTIONS` (reads
that emit secrets, **every** verb). The exfil class has **no debt ledger** — a
route handing out a private key has no acceptable interim state.

### NEXT ACTION — four routes remain, sharpest first

1. `messages/[messageId]` — **read the route before choosing.** It has PATCH,
   DELETE **and POST**. A new action with no special rule denies self-target,
   which is right for DELETE (an agent must not delete its COS's directives) but
   may break a legitimate self "mark read" on POST. Do not assume the three verbs
   share one capability.
2. `subconscious` — read `triggerSubconsciousAction` first; decide `send-command`
   (own surface) vs a new `drive-subconscious`.
3. `element-inventory` — confirm what it writes; likely `modify-agent`.
4. `metrics` — check the caller (if the agent's own hook writes it, self-drive
   matters); likely `modify-agent`.

Then Part 2 (`amp-init` self-remint) and Part 3 (dead `manage-amp-address`).
`UNREVIEWED_INVENTORY` reaches `[]` only when all four land — which is what closes
the parent TRDD-4Q7WMPZK.

**SUPERSEDED — do NOT carry forward.** The Part-1 table's `export` row
(`POST` / confidentiality) and the "Suggested shape" bullet proposing
`view-transcript` for it. Both were written from the route's name and its POST
handler, without reading `exportAgentZip`. They are kept below only so the error
stays legible.

**Tier 2.** Successor to the Tier-0 audit TRDD-4Q7WMPZK, which triaged all ten
agent-scoped routes that authorize nothing, fixed the three that were pure
mappings, and stopped where policy begins.

Nothing here is a new restriction. All five routes are **open today**: any
principal holding any valid agent token can call them against any agent. What is
missing is a decision about who *should* be able to, and every option requires
naming a capability the `AuthAction` union does not yet have.

## Why these could not be fixed in the Tier-0 EHT

Three routes were closed there because the action already existed and the only
question was wiring:

- `chat` POST ends in `sendKeys(literal, enter)` — it **is** `send-command`
  (`c7d9f8a7`).
- `queue/[entryId]` DELETE — `send-command` for the cross-agent case, plus
  ownership for self-target (`4b1a9b48`).
- `email/addresses/[address]` — its three siblings already used `modify-agent`
  (`6c905104`).

The five below reach capabilities the matrix has never modelled: *read another
agent's transcripts*, *delete another agent's messages*, *drive another agent's
subconscious*. Inventing an action is defining policy, so it is proposed.

## Part 1 — the five routes

| Route | Verbs | Reaches | Sharpness |
|---|---|---|---|
| `export` | POST | `createTranscriptExportJob` — any agent's FULL conversation transcripts | **confidentiality**; the highest-value data in the system |
| `messages/[messageId]` | PATCH DELETE POST | `deleteMessageById` etc. on any agent's AMP mailbox | **integrity of the governance channel** — an agent can delete the directives its COS sent it |
| `subconscious` | POST | `triggerSubconsciousAction` on any agent | drives another agent's background process |
| `element-inventory` | POST | writes agent element state | reconfiguration-adjacent |
| `metrics` | PATCH | `updateMetrics` on any agent | low blast radius; data integrity only |

`messages/[messageId]` deserves the sharpest look. AMP is title-gated by the
communication graph — who may *send* to whom is enforced. But who may *delete* a
delivered message is enforced by nothing. That is the same asymmetry that made
`queue/[entryId]` a fleet-wide denial of governance: gating the create verb is
worthless while the destroy verb is open. An agent that cannot be ordered because
it can silently delete its orders is not governed.

Suggested shape, for argument rather than adoption:

- **`view-transcript`** (new) — `export`. MANAGER anywhere, COS in-team, an agent
  on itself, system-owner. Note `view-agent` already exists and is documented as
  "currently open, for future lockdown" — deciding whether transcripts fall under
  it, or need their own action, is part of this proposal.
- **`manage-messages`** (new) — `messages/[messageId]`. The delete verb should
  almost certainly NOT be self-drive, for the reason above. An agent reading its
  own mailbox is fine; an agent deleting a COS directive out of it is not.
- **`drive-subconscious`** (new) or fold into `send-command` — depends on whether
  the subconscious counts as "the agent's own surface".
- `element-inventory` — likely `modify-agent`, but confirm what it writes.
- `metrics` — likely `modify-agent`. If the hook writes it on the agent's own
  behalf, self-drive matters; check the caller before choosing.

## Part 2 — `amp-init` re-mints an agent's own identity keys

`POST /api/agents/[id]/amp-init` does authorize, by hand:

```ts
if (auth.agentId && auth.agentId !== id) {
  if (!isManager(auth.agentId)) return 403
}
```

Correct for the cross-agent case, and it bypasses the matrix entirely — including
the universal self-target ban. So **an agent may re-mint its own AMP identity
keys.** Under TRDD-D3RP7KQZ an agent may drive its own surface and never
reconfigure itself, and an Ed25519 keypair is the sharpest piece of configuration
it has: re-minting it silently invalidates every signature its peers trust.

That reads like a self-reconfiguration the USER's decision already forbids. But it
was written deliberately, so it is raised rather than changed. If it is intended,
it should be an explicit exemption with its reason, not a hand-rolled check that
happens to skip `authorize()`.

## Part 3 — `manage-amp-address` is a dead action

Declared in the `AuthAction` union (SVC2-MAJ-18: "claim or remove an AMP address
on an agent record") and asserted in `tests/authorization.test.ts`'s
`SELF_FORBIDDEN` list. **Wired to zero routes.** All four address routes use
`modify-agent`.

An action that exists only in a test is worse than one that does not exist: it
reads as coverage. Either the four address routes adopt it — a real improvement,
since `modify-agent` is a blunt instrument for an address book — or it is deleted.
Both are one-line changes; choosing between them is the decision.

## Verification

- Each new `AuthAction` gets a matrix test at the `authorize()` boundary, per
  title and per self/other target, in `tests/authorization.test.ts`.
- Each route gets a behavioural suite in the shape of
  `tests/unit/chat-send-authorization.test.ts`, **falsified**: strip the guard and
  confirm the refusal assertions fail. A regression test that passes on the buggy
  code proves nothing, and this session already caught one of its own tests
  passing vacuously.
- `UNREVIEWED_INVENTORY` in `tests/unit/agent-route-authorization-coverage.test.ts`
  shrinks to `[]`, and the guardrail then fails the build if any new agent-scoped
  mutating route ships without an authorization step.

## Estimated risk

MEDIUM. Every option widens a surface from its current authorize-nothing state, so
the direction is tightening; the risk is choosing an action whose matrix is wrong
and having to migrate it later. LOW for `metrics` and `element-inventory`.

The risk of NOT deciding is concrete and current: **`export` and
`messages/[messageId]` are open right now.** Any agent on this host can read every
other agent's transcripts, and delete the messages its COS sent it.

## Approval log

- 2026-07-09T23:34:05+0200 — APPROVED by USER (tier 2), via the batch approval of
  four Tier-2 proposals. Rationale: `export` and `messages/[messageId]` are open
  right now; the standing directive is to prioritize security. Promoted
  `proposal → planned` and moved to `design/tasks/`.
- The proposal poses policy questions rather than answering them. Approval is read
  as a mandate to decide them under the USER's standing rule ("decide yourself,
  base decisions on verified facts, prioritize security"), taking the
  security-conservative fork at each choice and recording each decision here with
  the code that justifies it. Every suggested shape in the body is re-verified
  against the implementation before it is adopted — the body's suggestions are
  hypotheses, not findings.
