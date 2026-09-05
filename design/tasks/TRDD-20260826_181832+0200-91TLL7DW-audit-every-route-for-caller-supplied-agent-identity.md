---
trdd-id: 91TLL7DW
title: Kernel-attested identity is void on any route that takes the acting agent from a request parameter
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:18+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, agent-auth, api]
external-refs: [TRDD-EVO7T245, TRDD-NWTTU0AQ, TRDD-V2BLADSF, TRDD-RC33OAFQ]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:18+0200
---

## Problem

Kernel-attested identity is worth nothing if a route takes the ACTING agent from a request
parameter instead of from the verified credential. Then no forgery is needed — the caller
simply names someone else.

## Evidence — the foundation is currently CORRECT, which is why this is an audit not a fix

`lib/agent-auth.ts` derives `agentId` from the verified Bearer token / session, documented as
four outcomes with no parameter path. That is the right shape and it must be PINNED, because
a single future route that reads an id from the body silently undoes it.

The script layer already offers `--id UUID  Operate as this agent`, so the shape a reviewer
would have to catch is one an existing CLI flag makes look normal.

## Task

1. INVESTIGATE — enumerate every route that acts on a specific agent and record where it
   gets that agent: from `auth.agentId`, or from a path/body parameter.
2. ASSESS — for each parameter-sourced one, whether an authorization check binds the caller
   to the target.
3. SAFEGUARD — a test that fails when a route reads an agent id from a request without a
   paired authorization check.

## Acceptance

- [x] Route inventory with the identity source for each — 257 route files enumerated, 89
      reference an agent id. See the investigation section below.
- [ ] Every parameter-sourced route has a named authorization check. **THREE DO NOT**:
      `teams/notify` (reaches a tmux keystroke primitive, 0 authz calls), `agents/email-index`
      (no auth call at all), `sessions/activity/update` (unverified `sessionName`).
- [ ] A guard test reddens when a new route reads an agent id unchecked.

## Investigation — 2026-08-26 (read-only; inventory delegated, findings verified first-hand)

**257 route files enumerated, 89 reference an agent id.** 81 of those derive the acting identity
strictly from the verified `auth`/`authContext`, or pass a parameter-selected TARGET through
`authorize()` / `gate0Auth()` / `checkTeamAccess()` / `withAuthorizedTrdd()` / an explicit
`auth.agentId !== id` self-guard. Three do not.

### The one that matters — `app/api/teams/notify/route.ts` (VERIFIED BY READING IT)

```ts
const auth = authenticateFromRequest(request)      // caller authenticated...
if (auth.error) return 401
const parsed = NotifyTeamSchema.safeParse(raw)     // agentIds[] + teamName from the BODY
const result = await notifyTeamAgents(parsed.data) // ...and `auth` is never used again
```

`grep -cE "authorize|gate0Auth|checkTeamAccess|requireTitle|auth\.agentId"` on that file: **0**.

`notifyTeamAgents` maps over the caller's `agentIds` into `notifyAgent`, and its own comment reads
*"Strip control characters to prevent command injection via tmux send-keys"* — so the path
terminates in a **tmux keystroke primitive**. It sanitizes the MESSAGE and never checks whether the
CALLER may address those agents. Every sibling route reaching the same primitive does check.

**Design consequence, and it is the important part.** This is the confused deputy of Class 4.2:
the SERVER holds the tmux socket, so the agent does not need it. **A seatbelt profile denying the
tmux socket does NOT close cross-agent keystroke injection while this route stands** — the agent
simply asks the server to do it. Any authenticated agent, of any title, in or out of the team.

Confinement and route authorization are therefore NOT alternatives; the sandbox is void on every
capability the server will exercise on request.

### The other two

- `app/api/agents/email-index/route.ts:15` (GET) — **no auth call of any kind**; `agentId` query
  param goes straight to the service. Read-only, but genuinely unauthenticated.
- `app/api/sessions/activity/update/route.ts:22,72` (POST) — `sessionName` from the body is
  authenticated but unverified against the caller; carries an inline comment accepting it as a
  known limitation. That acceptance predates the impersonation threat model on this card set and
  should be re-decided, not inherited.

## Approval log

- 2026-09-05T10:21:18+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  route-identity audit — own acceptance boxes still open . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
