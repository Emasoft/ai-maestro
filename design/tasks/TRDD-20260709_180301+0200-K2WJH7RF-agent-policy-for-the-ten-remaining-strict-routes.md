---
trdd-id: K2WJH7RF
title: Decide the agent authorization policy for the ten remaining strict routes
column: human_review
pre-block-column: null
min-approval-requirement: manager
created: 2026-07-09T18:03:01+0200
updated: 2026-08-02T16:50:17+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: M
task-type: security
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: eht
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [authorization, sudo-guard, agent-path, trdd-api, janitor]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
attempts: 1
implementation-commits: [d7531e53, bc177864, 61364678]
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/76"]
---

# TRDD-K2WJH7RF — the ten routes the last decision did not cover

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-02

**Added 2026-08-02.** This card had none, and it spans many sessions — so a reader arrived at a body
written when NOTHING had been decided and took it for the current state. The IND rule makes a STATE
block mandatory exactly here.

**✅ ALL THREE PARTS ARE DONE** (`d7531e53` Parts 1+2, `bc177864` Part 3). `AGENT_POLICY_PENDING` is
**EMPTY** — the debt ledger is discharged. 39 tests green. The checked list is `## Acceptance` near
the bottom; the two things it does NOT cover are in `## ⏱ VERIFIED 2026-08-02`.

**SUPERSEDED — do NOT carry forward, all three are the pre-decision framing:**
- *"All ten routes 403 every agent today"* (body, line ~43) — the five `/api/trdd/*` verbs now work
  for agents under `manage-trdd`, within their tier;
- **the heading "Part 3 — the script layer has no USER auth path"** — it HAS one. `get_auth_args`
  resolves `$AID_AUTH` → `$AIMAESTRO_SESSION` → `~/.aimaestro/cli-session`, deployed. That section
  is the original problem statement, not a current fact;
- the Part-2 table's tentative *"MANAGER only? or owner-only"* — ruled owner-only.

**REMAINING:** an end-to-end run with a real `aim_tk_*` human token, and the human review this card's
own `review-requirements: [human-review]` asks for. Neither is an agent's to do.

**Tier 2.** Successor to TRDD-D3RP7KQZ, whose Approval log promises this file.

D3RP7KQZ asked a compound question. The USER answered its central half — an agent
may drive its own surface, never reconfigure itself — and that half shipped
(`4e507bfd`, `11cd98a6`). The rest is carried here rather than decided by silence.

Nothing below is a new restriction. All ten routes 403 every agent today, with an
explicit `agent_policy_undefined`. What is missing is a decision, not a guard.

## Part 1 — the five `/api/trdd/*` verbs

| Route | Wrapper subcommand |
|---|---|
| `PATCH /api/trdd/[id]` | `aimaestro-trdd.sh edit` |
| `POST /api/trdd/[id]/approve` | `aimaestro-trdd.sh approve` |
| `POST /api/trdd/[id]/refuse` | `aimaestro-trdd.sh refuse` |
| `POST /api/trdd/[id]/promote` | `aimaestro-trdd.sh promote` |
| `POST /api/trdd/[id]/archive` | `aimaestro-trdd.sh archive` |

These cannot map onto an existing `AuthAction`. Every current action is
**agent-targeted** — `authorize()` asks "may caller X act on agent Y". A TRDD has
no target agent. It has an approval TIER, and the tier names who may act.

So this needs a new `manage-trdd` action whose matrix mirrors
`aimaestro-trdd-approval.md` rather than the agent-target model:

| Verb | Who | Notes |
|---|---|---|
| `edit` (column transitions) | the TRDD's `assignee:`, its team's ORCHESTRATOR, MANAGER | the mechanical transitions are already EXEMPT per `aimaestro-manager-approval-defaults.md` §A |
| `approve` / `refuse` | by the proposal's `approval-tier:` — T1 COS, T2 MANAGER, T3 USER only | an agent must never approve a tier above its own authority |
| `promote` | whoever may `approve` it at its tier | promotion IS the approval act; the two must not diverge |
| `archive` | the owner, or MANAGER | `completed` \| `cancelled` \| `superseded` only |

**`archive failed` must stay refused.** A failed TRDD is retryable and stays open;
giving up on it is an explicit `cancel`. The wrapper already enforces this — the
server must too, or the wrapper is the only thing standing between a lost task and
a retried one.

**The hard part is `approval-tier`.** Authorizing `approve` requires reading the
target TRDD's own `approval-tier:` from disk, inside `authorize()`, which today is
synchronous and touches only the registry and the team file. Either the route
resolves the tier and passes it in, or `authorize()` grows a filesystem read. The
first is cleaner and keeps `authorize()` honest about what it knows.

**Self-approval is the thing to prevent.** An agent that can `approve` its own
Tier-2 proposal has defeated the approval system entirely. Whatever shape this
takes, `proposed-by == caller` must be refused for `approve` and `promote`, in the
same way `authorize()` already refuses `change-title` on self even for a MANAGER.

## Part 2 — the five governance routes

| Route | First reading | Suggested |
|---|---|---|
| `POST` / `DELETE /api/governance/maestro-delegate` | delegating the human owner's authority | `SYSTEM_OWNER_ONLY_STRICT` — no agent delegates the maestro |
| `POST /api/agents/foreign-approvals/[id]/{approve,reject}` | approving an agent from another host | MANAGER only? or owner-only — cross-host trust is the sharpest edge in the system |
| `POST /api/system/aid-recover` | recovering an agent identity | `SYSTEM_OWNER_ONLY_STRICT` — identity recovery is the root of the trust chain |

Two of the three look like `SYSTEM_OWNER_ONLY_STRICT` on sight. Moving them there
changes no behaviour (403 before, 403 after) and converts a shrug into a stated
position — which is the only reason `AGENT_POLICY_PENDING` exists.

`foreign-approvals` is the one worth thinking about. A MANAGER admitting a foreign
agent is plausible and useful; it is also exactly how a compromised MANAGER on one
host would admit itself to another. Recommend owner-only until someone can argue
the MANAGER case properly.

## Part 3 — the script layer has no USER auth path

`scripts/shell-helpers/common.sh::get_auth_args` emits only
`Authorization: Bearer $AID_AUTH`. No wrapper understands the `aim_session`
cookie. So a human running `aimaestro-panel.sh status <agent>` from their own
terminal gets `401 auth_required` — while `docs/SCRIPT-LAYER.md` describes a USER
path that exists in the server and not in the scripts.

Either teach `get_auth_args` about `aim_session`, or state plainly that a human
must hold a user-AID token. Whichever — the wrapper's documented contract must
become true. Verified 2026-07-09.

## Verification

- `AGENT_POLICY_PENDING` shrinks to exactly the routes still undecided; the
  coverage guardrail (`tests/unit/sudo-guard-strict-agent-coverage.test.ts`) pins
  the rest and fails if one is delisted without being mapped.
- `manage-trdd` gets a matrix test at the `authorize()` boundary per tier and per
  title, including: an agent cannot approve its own proposal; an agent cannot
  approve above its tier; `archive failed` is refused.
- The five governance routes, once declared owner-only, are asserted so by the
  existing `SYSTEM_OWNER_ONLY_STRICT` superset test.
- End to end: a real `aim_tk_*` token drives `aimaestro-trdd.sh search|read` (works
  today) and each write verb with the decided outcome.
- `ai-maestro-janitor#76` is corrected again once this lands — its command
  reference currently tells the janitor to skip the TRDD write verbs.

## Estimated risk

MEDIUM for Part 1 — it widens an authorization surface and introduces the first
non-agent-targeted `AuthAction`, so `authorize()`'s shape changes. LOW for Part 2
(no behaviour change). LOW for Part 3.

The risk of NOT deciding is that `aimaestro-trdd.sh` stays half a tool: the
janitor can read the board and cannot touch it, and every agent that tries gets a
403 that correctly says nobody has decided.

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list plus its Part 3, re-run live.
The card is in `human_review` with `review-requirements: [human-review]`, so the last box is the
human's read and the one before it needs a credential an agent must not hold.

- [x] **`AGENT_POLICY_PENDING` shrank to exactly the undecided routes — which is NONE.** The set is
      literally `EMPTY` in `lib/sudo-guard.ts:290`, with the discharge recorded in place: the five
      governance routes → `SYSTEM_OWNER_ONLY_STRICT`, the five `/api/trdd/*` verbs →
      `STRICT_AGENT_RULES` under `manage-trdd`. Emptying the ledger IS the epic
- [x] the coverage guardrail pins the rest and fails if a route is delisted without being mapped —
      `tests/unit/sudo-guard-strict-agent-coverage.test.ts`, green
- [x] **`manage-trdd` exists as a NON-agent-targeted `AuthAction`** (`lib/authorization.ts:65`), the
      first of its kind, with the decision logic in `lib/trdd-authz.ts` and every route wired to
      `authorizeTrddVerb` — including `edit` and `archive`, which reach it through the helper rather
      than naming the action, so a grep for `manage-trdd` in those two files reads 0 and means
      nothing
- [x] it **fails CLOSED with no TRDD context** — *"a guessed tier is a guessed approval"*
- [x] **matrix test per tier and per title** — `tests/unit/manage-trdd-authorization.test.ts`.
      **39 tests green across both files**, and the three the card named by hand are all there:
      an agent cannot approve its OWN proposal (MANAGER included), no agent may approve a
      `user`-tier TRDD (MANAGER included), and `archive failed` is REFUSED
- [x] `promote` carries EXACTLY `approve`'s authority — pinned as its own test, *"else it launders
      an approval"*. The card predicted this and the test states the reason
- [x] `refuse`-your-own IS allowed while `approve`-your-own is not — a withdrawal costs the system
      nothing. A distinction the card did not draw and the implementation got right
- [x] **the five governance routes are owner-only**, listed in `SYSTEM_OWNER_ONLY_STRICT`
      (`:245-250`) with the per-route reasoning in place, including the one the card flagged as
      genuinely arguable: `foreign-approvals` stays owner-only *"until someone argues the MANAGER
      case properly — the burden belongs on widening, not on closing"*
- [x] **Part 3 — the script layer HAS a USER auth path**, contrary to what this card and
      `docs/SCRIPT-LAYER.md` both said. `get_auth_args` resolves `$AID_AUTH` → `$AIMAESTRO_SESSION`
      → `~/.aimaestro/cli-session`, landed in `bc177864` (2026-07-14, ai-maestro#55), and the
      INSTALLED `~/.local/share/aimaestro/shell-helpers/common.sh` carries it. The doc was 19 days
      stale and is corrected — see below
- [x] **`ai-maestro-janitor#76` is corrected** — read live: a comment titled *"CORRECTION — the five
      TRDD write verbs are now LIVE for agents"* says the issue's command reference *"told you to
      skip"* them and that this is *"no longer true"*
- [ ] **end to end with a real `aim_tk_*` token** driving each write verb. Needs a live human
      session token; an agent holding one would defeat the very separation this card decided
- [ ] **human review** — `review-requirements: [human-review]` on a card that widened an
      authorization surface and introduced the first non-agent-targeted `AuthAction`. That is the
      column it sits in

## ⏱ VERIFIED 2026-08-02 — Part 3 was DONE and the doc still said it was not

The card's Part 3 asks for one thing: *"Either teach `get_auth_args` about `aim_session`, or state
plainly that a human must hold a user-AID token. Whichever — the wrapper's documented contract must
become true."*

**It became true in the code and stayed false in the doc.** `docs/SCRIPT-LAYER.md` carried a section
headed *"One thing that is NOT true yet"* asserting there is no USER auth path and that teaching it
the cookie *"is open work"* — 19 days after `bc177864` built exactly that, and after the doc was
itself edited (`fb86650d`, 2026-07-30) without the paragraph being caught.

The drift is instructive rather than embarrassing: `common.sh`'s own comment reads *"Until now these
helpers emitted ONLY the bearer"*, so the fix **knew** it was falsifying that text, and the text was
not told. **A doc that claims a capability is MISSING is worse than one that omits it — the reader
stops looking.** Corrected in `61364678`, along with the general rule: when you close a "not true
yet" item, delete the paragraph in the same commit.

## Approval log

- 2026-07-09T23:34:05+0200 — APPROVED by USER (tier 2), in the batch of four.
  Promoted `proposal → planned`, moved to `design/tasks/`. Sequenced AFTER
  TRDD-YEE33F3A: both extend the same `AuthAction` union and the same
  `authorize()` matrix, so landing them concurrently would conflict on every
  shared file. `blocked-by: [TRDD-YEE33F3A]` set accordingly.
