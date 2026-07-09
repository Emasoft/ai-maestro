---
trdd-id: D3RP7KQZ
title: Decide the agent authorization policy for the 14 pending strict routes
column: proposal
approval-tier: 2
created: 2026-07-09T16:42:56+0200
updated: 2026-07-09T16:42:56+0200
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: M
task-type: security
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
blocked-by: []
relevant-rules: []
labels: [authorization, sudo-guard, agent-path, janitor]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/76"]
---

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
