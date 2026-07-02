---
trdd-id: 47effd69-6ca1-462c-931b-f593866265cd
title: registerAgent must flag roleMissing on the role-less agent it creates from a session (R9.13)
column: complete
created: 2026-06-21T01:49:35+0200
updated: 2026-06-21T01:49:35+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: bugfix
severity: HIGH
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [governance, r9.13, register-agent, security]
---

# TRDD-47effd69 — registerAgent R9.13 (role-less created agent must be flagged)

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), fix-queue #6.
The LAST identified governance-compliance gap (cond 1: "all functions obey the
governance rules"). R9.13 = every persisted agent MUST carry a role-plugin.

## Problem (the gap)
`registerAgent` (`services/agents-core-service.ts`, called by `/api/v1/register`,
`/api/agents/register`, headless) has a `body.sessionName && !body.id` path
(system-owner only — the register-agent-from-session flow). When no existing agent
matches the session, it creates one via the **raw `createAgent`** registry
primitive (`lib/agent-registry.ts:458`) — which sets NO governanceTitle, NO
rolePlugin, NO roleMissing. So it **bypasses the CreateAgent AIO** that installs a
role-plugin (R9.13), leaving a **role-less agent with `roleMissing` unset**.

The wake route (`app/api/agents/[id]/wake/route.ts:40`) enforces R9.13 by gating
on `agent?.roleMissing` → `role_plugin_required` (409). Because registerAgent left
`roleMissing` unset, that gate never fired — so a role-less agent created via
registerAgent could **wake with no role-plugin**, violating R9.13 silently.

## Why the fix is a flag, not a plugin install
The created agent's **workdir does not exist at register time** — `createAgent`
makes it on first wake (the code comment at the existing-agent branch is explicit).
So a role-plugin CANNOT be installed at register time (no workdir to install into).
The correct, system-consistent action is to **flag `roleMissing: true`** so the
EXISTING wake-route R9.13 gate blocks the agent until a role is assigned via the
Config tab (which installs it properly, workdir present). This mirrors how the rest
of the system handles role-loss: ChangeTitle **G17** (TRDD-51ed3b0b), ChangePlugin
**PG04**, and the wake-path **R17 `corePluginMissing`** all create/keep-then-flag,
never silently leave an agent non-compliant.

## Fix
In registerAgent's new-agent branch, right after `agentId = registryAgent.id`
(inside the createAgent `try`, so it only runs on success):
```ts
await updateAgent(agentId, { roleMissing: true }).catch((flagErr) => {
  console.warn(`[Register] Could not flag roleMissing on ${agentId}:`, flagErr)
})
```
The `.catch` keeps a flag-write failure from orphaning the just-created agent's id
via the `createError` fallback (which would set `agentId = uuidv4()`). Scoped to the
new-agent (session) path ONLY — the existing-agent **link** path (it owns its own
role state) and the **cloud** path (caller-supplied full config) are untouched.

## TDD (RED → GREEN) + a bug autopsy
`tests/services/agents-core-service.test.ts` — 2 new cases: (1) the new-agent path
flags `roleMissing: true` (RED-verified: 0 calls before the fix); (2) the
link-existing path does NOT (scoping). Both green after.

**Autopsy — the fix initially broke an existing test** (`registers agent from
session name` → `expected 'uuid-1' to be 'new-id'`): the test's `updateAgent` mock
was a bare `vi.fn()` returning `undefined`, so `undefined.catch()` THREW → the
`createError` fallback set `agentId = uuidv4()`. Production `updateAgent` is async
(returns a Promise) so `.catch` is correct there — the MOCK was inaccurate. Fixed
the mock (`mockResolvedValue(undefined)` in the beforeEach defaults), not the
production code. Lesson: a mock for an async function MUST resolve a Promise when
production uses `.catch`/`.then` on its return.

## Verification
- `tsc --noEmit` clean (pre-existing deprecation/unused hints in agents-core are not
  errors and not from this change).
- agents-core-service test file: 83/83.
- **Full unit suite: 107 files, 1866 passed / 0 failed** (+2 new tests), 2
  pre-existing skips. Zero regressions.

## Implementation (2026-06-21)
`services/agents-core-service.ts` (the roleMissing flag) +
`tests/services/agents-core-service.test.ts` (2 cases + the async-mock fix) +
`docs/API-CHANGES.md` §12. Landed in the overnight campaign (TRDD-903b7a20). Not
pushed. With this, all four identified cond-1 governance gaps are fixed
(sessions-browser auth, ChangeFolder confine, ChangeTitle R9.13, registerAgent R9.13).
