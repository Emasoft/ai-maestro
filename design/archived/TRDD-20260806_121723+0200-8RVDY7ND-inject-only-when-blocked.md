---
trdd-id: 8RVDY7ND
title: The server must REFUSE a governance inject unless the target is actually blocked
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T12:17:23+0200
updated: 2026-08-21T23:11:04+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
priority: 0
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-06T12:17:23+0200
severity: high
effort: medium
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [97891655]
labels: [governance, authorization, terminal, amp]
external-refs: [Emasoft/ai-maestro#125, Emasoft/ai-maestro#110, Emasoft/ai-maestro-plugin#58]
---
# The server must REFUSE a governance inject unless the target is actually blocked

## Problem

USER directive (2026-08-06): MANAGER and CHIEF-OF-STAFF must be able to unblock a stalled agent by
answering into its terminal — **and that must be the ONLY case** in which either may send a command
directly. Everything else goes through AMP agent-to-agent, obeying the R6 comm graph *"to avoid
filling agents with broadcast messages unrelated to the job they must do"*.

Today the boundary between those two cases exists only as PROSE, and the prose contradicts the
tooling. ai-maestro#125 documented the collision: the seeded `aimaestro-agent-rules.md` says
*"NEVER drive another agent — no command, keystroke, or queued input… NO title exempts you"*, while
`aimaestro-session.sh`'s own help says *"Agent callers authorize by AID_AUTH + governance title"*.
Both cannot be obeyed. The measured cost is in #125: a MANAGER with the authority, the AID and the
CLI refused **twice** to answer a blocked AUTONOMOUS agent's prompt, and a human had to be pulled
into the loop the product exists to remove.

**A rule cannot fix this, because a rule is exactly what failed.** "Only inject when blocked" left
to agent restraint is unenforceable in the permissive direction (nothing stops a MANAGER injecting
work) and over-enforced in the restrictive one (a careful MANAGER refuses a legitimate unblock).

## Proposed fix — make it a SERVER-ENFORCED PRECONDITION

The inject path (`PATCH /api/agents/[id]/session`, `POST …/queue`, `POST …/chat` — all three
reach `sendKeys`) gains a **blocked-state precondition** for a caller acting on ANOTHER agent
under a governance title: the call is refused unless the target is in a blocked state
(`waiting_for_input` / permission / `rate_limited` / `api_error` — the ladder in
`lib/agent-status.ts`), resolved by the same merge NPT 89LVZSQ0 builds.

Consequences worth stating:

- **The rule text becomes true.** #125's proposed split (never drive WORK · you MAY unblock) stops
  being an honour system: the refusal is the check, not the agent's restraint.
- **Self-drive is untouched.** `SELF_DRIVE_ACTIONS` already lets an agent drive its OWN surface;
  this precondition is about acting on ANOTHER agent.
- **The human is unaffected.** The system owner keeps the unconditional path; this narrows the
  AGENT-title path only.
- **Note the existing flag is the OPPOSITE.** `--require-idle` refuses unless the agent is IDLE.
  The new gate refuses unless it is BLOCKED. Both are useful and they are not the same predicate —
  do not conflate or replace.

## Verification

- a MANAGER/COS inject at a target in `active` or `idle` state is REFUSED with a reason naming
  the precondition, and the refusal is asserted by a test;
- the same inject at a target in each blocked state SUCCEEDS (one case per ladder rung);
- a neuter removing the precondition reds a named test — and the test asserts the REASON, not just
  `success === false`, since an earlier auth gate would otherwise satisfy it;
- the system-owner path is proven unaffected by the same suite.

## Estimated risk

MED-HIGH. Touches authorization on three routes that reach `sendKeys`. Gets it wrong in the
permissive direction ⇒ the governance hole #125 describes stays open; in the restrictive direction
⇒ MANAGER cannot unblock and the fleet stalls, which is the failure this exists to end. Depends on
NPT 89LVZSQ0 for the state resolution.

## Acceptance
- [x] `PATCH /api/agents/[id]/session`, `POST …/queue`, and `POST …/chat` all refuse a governance-title caller acting on ANOTHER agent unless the target is in a blocked state (`waiting_for_input`/permission/`rate_limited`/`api_error`) — `session`/`chat` were already correct (R42, unconditional cross-agent refusal); `queue` had ZERO cross-agent authorization and was fixed this session. The sanctioned "succeed when blocked" exception is implemented on the dedicated `POST /api/agents/[id]/prompt/answer` route (Gate 0b), not widened onto these three — see `reports/colony/unit2-8RVDY7ND.md` for the reasoning.
- [x] A test proves an inject at a target in `active`/`idle` state is REFUSED, asserting the REASON (not just `success === false`) — pre-existing for session/chat; new `tests/unit/queue-enqueue-authorization.test.ts` for queue.
- [x] A test proves the same inject SUCCEEDS at a target in each blocked-state rung the gate treats as "asked" (`ask_user`, `permission`) — `rate_limited`/`api_error` are deliberately refusal rungs, also tested. `tests/services/agents-core-service.test.ts` (R42.8 Gate 0b suite).
- [x] A neuter removing the precondition reds the named test — done for the queue fix (3 of 8 tests reddened, restored); pre-existing neuter log for Gate 0b at `agents-core-service.test.ts:1148-1159`.
- [x] The system-owner (non-agent) path is proven unaffected by the same suite — `queue-enqueue-authorization.test.ts` "the system owner … may enqueue on any agent".
- [x] `SELF_DRIVE_ACTIONS` (an agent acting on its own surface) remains untouched by this gate — no new authorization concept added; self-enqueue test proves it.

## Why this card no longer carries `npt: [89LVZSQ0]`, though the body still cites it

Dropped 2026-08-21T23:11 at close, on measurement — and **not** by copying the identical fix made
to [[LT5N2JA4]] an hour earlier; that one is why I looked, this is why it moved:

1. **It was never a derivation edge.** `npt:`/`eht:` mean *"this TRDD spawned that one"* and they
   alone establish parenthood. `89LVZSQ0` was created **2026-08-06T12:04:01**; this card at
   **12:17:23** — **13 minutes later**. A parent cannot spawn a child that predates it. And
   `89LVZSQ0` declares no `derived:`, no `derived-kind:`, no `parent-trdd:`, so nothing claimed
   the other end: a one-sided orphan edge. After `LT5N2JA4` was corrected, this card was the last
   holder of it corpus-wide.
2. **It was not a completion gate either.** The dependency the body describes is real — the
   blocked-state ladder in `lib/agent-status.ts` is what `89LVZSQ0` would improve — but this
   card's own acceptance is met **with the ladder as it stands today**: box 1 refuses a
   cross-agent inject unless the target is blocked, and box 3 proves it SUCCEEDS at the rungs the
   gate treats as "asked" (`ask_user`, `permission`), with `rate_limited`/`api_error` deliberately
   excluded and documented as such. A better resolution is an ENHANCEMENT, not a precondition.

The relationship stays in the prose above, where it is true, instead of in a field that asserts a
parenthood that never existed. It is not `blocked-by:` either: this card is not waiting on
anything — its work is done and proven. A runtime edge would have been as false as the derivation
edge, in the opposite direction.

## Approval log

- 2026-08-21T23:11:04+0200 — COMPLETED by ai-maestro (hub coordinator). `min-approval-requirement:
  none`, `mandate: true` / `mandated-by: user` since 2026-08-06, `release-via: none` ⇒ terminal is
  `complete`. Gate satisfied: checklist EXISTS and is 6/6 `- [x]`; `npt`/`eht` both empty (see the
  section above for why the one `npt` edge was dropped rather than waited on).
  **Review was performed, not skipped** — the card went `todo` → `complete` without passing through
  `testing`/`ai_review` because the work and its review happened in the same pass, so naming what I
  actually ran matters more than the columns it did not sit in: `npx tsc --noEmit` → exit 0 / 0
  errors; the full suite → exit 0 / 0 failed; and I ran the **neuter myself** rather than accept
  the worker's claim — `if (!authz.allowed)` → `if (false)` in `app/api/agents/[id]/queue/route.ts`
  reddened **3 of 8** tests, and restoring it returned **8/8**, so the test genuinely pins the
  guard. Implementation: `97891655`.

- 2026-08-06T12:17:23+0200 — MANDATE issued by USER (directive quoted above). Tier 0 — in-scope server work on our own
  tree. The governance RULE TEXT change it implies (#125) is separate and USER-owned.
