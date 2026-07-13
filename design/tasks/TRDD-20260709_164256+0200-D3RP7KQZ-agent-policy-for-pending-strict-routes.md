---
trdd-id: D3RP7KQZ
title: An agent may drive its own surface, never reconfigure itself
column: complete
min-approval-requirement: manager
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:05:00+0200
created: 2026-07-09T16:42:56+0200
updated: 2026-07-13T14:05:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
task-type: security
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: eht
npt: []
eht: []
blocked-by: []
pre-block-column: null
relevant-rules: []
labels: [authorization, sudo-guard, agent-path, janitor]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
last-test-result: pass
last-test-at: 2026-07-09T17:30:00+0200
implementation-commits: [4e507bfd, 11cd98a6]
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/76"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-09

**DECIDED by the USER on 2026-07-09, and implemented.** The proposal below asked
a compound question. The USER answered the central half; the rest was carved out
into a successor proposal. Read the Approval log first — it is the decision.

**Why `blocked` and not `complete` (updated 2026-07-10T02:49):** the code landed
and the gates are green, but 4Q7WMPZK is still open. Per the USER's completion
rule, a TRDD whose flock is still under development is **not** complete and its
column says `blocked` — prose saying "not really done" gates nothing. It also
carries `review-requirements: [human-review]`, recorded in
`pre-block-column: human_review`; both are satisfied by the same act (the USER
reviewing the shipped invariant, and the audit closing).

4Q7WMPZK is now a **sibling**, not a child: under the depth-1 rule a derived TRDD
has no derived TRDDs, so this TRDD's `eht:` is `[]` and 4Q7WMPZK moved up into the
epic's flock. The dependency survives where dependencies belong — `blocked-by:`.

- **Decided + shipped:** the self-drive / self-configure split. `SELF_DRIVE_ACTIONS
  = {send-command, hibernate-agent}` in `lib/authorization.ts`; the panel / queue /
  prompt-answer trio mapped to `send-command`, `PATCH /api/agents/[id]` to
  `modify-agent`. Commits `4e507bfd`, `11cd98a6`.
- **Also shipped, not asked for:** `install-skills` never authorized at all
  (`enforceAuth` authenticates only). Fixed, plus a coverage guardrail over the
  whole agent-scoped mutation surface. Follow-up: **TRDD-4Q7WMPZK** (EHT).
- **NOT decided, carried forward:** the ten routes still in `AGENT_POLICY_PENDING`
  (five `/api/trdd/*` verbs, maestro-delegate ×2, foreign-approvals ×2,
  aid-recover), and the script layer's missing USER auth path.
- **SUPERSEDED — do NOT carry forward:** the "Options" section's four-way choice.
  Option 2 was taken. `AGENT_POLICY_PENDING` no longer contains the four decided
  routes, so the "Problem" section's "fourteen" is now ten.

# TRDD-D3RP7KQZ — agent authorization policy for the 14 pending strict routes

**Tier 2 (MANAGER).** This decides which governance titles may drive another
agent's terminal, panel, and command queue, and who may approve/promote/archive a
TRDD through the API. That is governance policy, not a mapping detail, so it is
proposed rather than self-approved.

## Problem

`lib/sudo-guard.ts::requireAidTitle` refuses any agent caller on a strict route
that is absent from `STRICT_AGENT_RULES`. The refusal is correct as a default
(fail closed) but it is silent — a bare 403 "This operation is not available to
agents", indistinguishable from a deliberate exclusion.

**Fourteen strict routes are in that state.** Verified empirically on 2026-07-09
(`tests/unit/sudo-guard-strict-agent-coverage.test.ts`): a MANAGER-titled agent is
refused on every one of them.

Eight were shipped by epic TRDD-SCLSRS6E — whose entire purpose was to give the
**janitor**, an agent, control of the fleet:

| Route | Built for |
|---|---|
| `POST /api/agents/[id]/panel` | visualizer plugins showing the human something |
| `POST /api/agents/[id]/queue` | queue `/compact`, `/reload-plugins` for a busy agent |
| `POST /api/agents/[id]/prompt/answer` | answer a pending permission / AskUserQuestion menu |
| `PATCH /api/trdd/[id]` + `approve`/`refuse`/`promote`/`archive` | the 3-pillars task API |

So the epic's whole write surface is inert for its only intended consumer. Worse,
`Emasoft/ai-maestro-janitor#76` — the command reference I filed — states the
opposite ("agent callers authorize by AID + governance title and need none"). It
must be corrected whichever way this proposal is decided.

Six more predate the epic and were surfaced by the same guardrail:
`PATCH /api/agents/[id]`, `POST`/`DELETE /api/governance/maestro-delegate`,
`POST /api/agents/foreign-approvals/[id]/{approve,reject}`,
`POST /api/system/aid-recover`.

## What was already done (and deliberately NOT done)

TRDD-6A2I6ZO0 declared all 14 in a new `AGENT_POLICY_PENDING` ledger. **No
authorization changed** — 403 before, 403 after. The refusal now says
`agent_policy_undefined` instead of lying about intent, and a coverage test pins
the ledger so a new strict route cannot ship undeclared.

The policy itself was left open on purpose, because the obvious answer is wrong.

## The real question: self-target semantics

The natural mapping for the three agent-control routes is the existing
`send-command` AuthAction (the panel route's own comment says it carries "the same
trust level as injecting into a terminal"), with `targetFromPathId: true`.

But `lib/authorization.ts::authorize()` enforces a **universal** rule:

```
// ── Universal rule: no agent can modify itself via API ──
if (targetAgentId && targetAgentId === auth.agentId) {
  return { allowed: false, reason: 'No agent can modify itself via the AI Maestro API' }
}
```

That mapping would therefore deny:

- an agent pushing HTML to **its own** dashboard panel — the primary visualizer
  use case, and the reason the panel exists;
- an agent enqueuing `/compact` on **itself** — exactly what a janitor does;
- an agent answering **its own** pending permission prompt.

The self-modification rule exists because "agents operate through their own Claude
Code instance directly" — they should not mutate their own registry record. But
the panel and the queue are not registry mutations; they are an agent talking to
its own surface. The rule's rationale does not obviously extend to them.

## Options

1. **Map to `send-command`, keep the self-target ban.** Safest; leaves the
   visualizer's main case dead. Probably wrong.
2. **Map to `send-command`, add a self-target exemption for the control routes.**
   Narrow carve-out in `authorize()` for `send-command` on panel/queue/prompt.
   Needs a stated reason for why self-drive is safe here but not for `modify-agent`.
3. **New AuthAction `drive-surface`** for panel/queue/prompt, with its own matrix
   (self allowed; others require MANAGER, or COS within team). Cleanest separation;
   most code.
4. Leave the control routes owner-only and give the janitor a **user AID token**
   instead of an agent identity. Sidesteps the model; probably a governance smell.

For the five `/api/trdd/*` verbs a new `manage-trdd` action is needed regardless.
Its matrix should mirror the approval tiers (`aimaestro-trdd-approval.md`):
`approve`/`refuse` are COS/MANAGER/USER by tier; `promote` is the owner's; the
`failed` state is never archived.

## Also in scope: the script layer has no USER auth path

`scripts/shell-helpers/common.sh::get_auth_args` emits only
`Authorization: Bearer $AID_AUTH`. No wrapper supports a session cookie, so
`aimaestro-panel.sh status <agent>` from a human's terminal returns `401
auth_required` — while its own header claims "the local owner needs none".

Verified 2026-07-09. Practically: agents reach the non-strict verbs (they carry
`AID_AUTH`) and are 403'd on the strict ones; a human reaches nothing. Whatever
this proposal decides, the wrapper's documented contract must be made true —
either by teaching `get_auth_args` about `aim_session`, or by documenting that a
USER must hold a user-AID token.

## Verification

- Extend `tests/unit/sudo-guard-strict-agent-coverage.test.ts`: every route removed
  from `AGENT_POLICY_PENDING` must resolve to an explicit allow/deny per title
  (MANAGER, COS in-team, COS out-of-team, MEMBER, AUTONOMOUS, self).
- End-to-end: a real `aim_tk_*` agent token drives `panel`/`queue` on another agent
  and on itself, with the decided outcome in each case.
- Correct `ai-maestro-janitor#76` to match whatever is decided.

## Estimated risk

MEDIUM. Every option widens an authorization surface from its current
deny-everything state. The blast radius is bounded by `authorize()`, which is
already the single source of truth and is well covered. The risk of NOT deciding
is that the epic stays inert and the janitor's command reference stays wrong.

## Approval log

- 2026-07-13T14:05:00+0200 — **HUMAN REVIEW PASSED, and the carried-forward half
  is now DECIDED.** USER, verbatim:

  > yes, ok for the 10 routes (actually more routes are coming, but now we need to
  > focus on making ai-maestro harness working). the scripts if executed via cli by
  > the user manually MUST require to enter the password of the MAESTRO USER, of
  > course. other non MAESTRO users are not contemplated.

  Three things, and the third is new work:

  1. **The ten `AGENT_POLICY_PENDING` routes are approved** as proposed — the five
     `/api/trdd/*` verbs, maestro-delegate ×2, foreign-approvals ×2, aid-recover.
  2. **More routes are coming, and that is expected.** The policy is the durable
     artifact; the route list is not. A new route inherits the self-drive /
     self-configure split rather than re-opening it.
  3. **The script layer gets a USER auth path, and it is a PASSWORD prompt.** A
     script run manually from the CLI MUST require the MAESTRO USER's password.
     **There is exactly one human principal — MAESTRO. Non-MAESTRO users are not
     contemplated**, so the script layer needs no user model, no roles, no
     multi-tenant story: one principal, one password prompt. That closes the
     "script layer has no USER auth path" gap this TRDD carried forward, and it
     closes it *narrowly* — which is why it is cheap. Successor: **TRDD-9MZQ4T7E**.

  `review-requirements: [human-review]` is satisfied, and the flock gate is too:
  the sibling audit **4Q7WMPZK** reached `completed` and is archived. The body's
  STATE block still says it is open — that is STALE, and this line supersedes it.
  Both gates clear ⇒ `column: complete`.

- 2026-07-09T17:45:00+0200 — **APPROVED by the USER (tier 2; USER is the tier-3
  authority and may decide a tier-2 proposal directly).** The decision, verbatim:

  > an agent cannot change its own configuration. only the chief of staff or the
  > manager can. so the skills to uninstall role plugins, extensions, mcp, hooks,
  > subagents, etc. are all forbidden to it. only COS and MANAGER can (and of
  > course the user via the UI). but it can use the skills to hibernate itself, or
  > to send commands directly to the terminal (the same way the janitor does), to
  > open the html panel, to get info on the team or the projects assigned (but not
  > changing them). this is essential to prevent an agent to accidentally
  > reconfigure itself and lose its own ability to work its role correctly, or to
  > remove itself from the team, or to change role or to install plugins.

  Resolves the "self-target semantics" question as **Option 2**: map the control
  routes to `send-command` and exempt self-targeting for a narrow, closed set of
  DRIVE actions. The USER's rationale supplies the principle the proposal was
  missing — the exempted actions are precisely those an agent could already
  perform by typing into its own terminal; configuration is not one of them, and
  a self-reconfigure is the one mistake an agent cannot recover from.

  `hibernate-agent` is in the set on the USER's explicit instruction ("it can use
  the skills to hibernate itself"). `wake-agent` is not, and cannot be: a sleeping
  agent is not there to wake itself.

  The USER further noted a limit of this decision, recorded as **TRDD-B6XN2VKD**:
  an agent can always shell out to `claude` and install plugins anyway. Team
  agents are to be discouraged; blocking `claude` execution via
  `settings.local.json` deny permissions is future work that must be TESTED
  before it is believed.

- 2026-07-09T17:51:47+0200 — **SCOPE NARROWED, then COMPLETED.** The USER's
  decision covered the agent-control surface and the self-configuration ban. It
  did not cover the five `/api/trdd/*` verbs (which need a new `manage-trdd`
  action whose matrix mirrors the approval tiers), nor `maestro-delegate`,
  `foreign-approvals`, or `aid-recover`, nor the script layer's missing USER auth
  path. Those ten routes remain in `AGENT_POLICY_PENDING` and are carried into a
  successor proposal rather than decided by silence: **TRDD-K2WJH7RF**
  (`design/proposals/`, tier 2, awaiting the USER or MANAGER).
