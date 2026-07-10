---
trdd-id: K2WJH7RF
title: Decide the agent authorization policy for the ten remaining strict routes
column: planned
min-approval-requirement: manager
created: 2026-07-09T18:03:01+0200
updated: 2026-07-09T23:34:05+0200
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
blocked-by: [TRDD-YEE33F3A]
supersedes: []
superseded-by: []
relevant-rules: []
labels: [authorization, sudo-guard, agent-path, trdd-api, janitor]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
attempts: 0
implementation-commits: []
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/76"]
---

# TRDD-K2WJH7RF — the ten routes the last decision did not cover

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

## Approval log

- 2026-07-09T23:34:05+0200 — APPROVED by USER (tier 2), in the batch of four.
  Promoted `proposal → planned`, moved to `design/tasks/`. Sequenced AFTER
  TRDD-YEE33F3A: both extend the same `AuthAction` union and the same
  `authorize()` matrix, so landing them concurrently would conflict on every
  shared file. `blocked-by: [TRDD-YEE33F3A]` set accordingly.
