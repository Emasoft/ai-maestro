---
trdd-id: YB4T4RTL
title: Converge the 37 non-AIO mutation sites onto their all-in-one functions
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-25T23:51:47+0200
updated: 2026-07-26T05:14:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-25T23:51:47+0200
relevant-rules: [R50]
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

USER first principle (2026-07-25): *"THERE MUST BE ONLY ONE FUNCTION FOR EACH OPERATION, AND THAT
FUNCTION MUST BE AN ALL-IN-ONE."* Codified as **R50** (GOVERNANCE-RULES v4.9.0).

An audit found **11 call sites performing agent operations outside their all-in-one**. Each skips
every gate the pipeline owns — cemetery archive, team-slot clearing, credential revocation, session
unpersist, the G10 post-condition. This is not theoretical: the `PersistedSession` row that outlived
every deleted agent and kept resurrecting its workdir (TRDD-KERM18NX) survived because one store had
no owner in the pipeline. A bypass reproduces that condition on purpose.

**The ratchet is already in place** — `tests/unit/all-in-one-single-path.test.ts` pins the set, so it
can only shrink and a NEW bypass fails the build. This TRDD is the convergence work itself.

## ⚠ SUPERSEDED COUNT — it is 37, not 11 (2026-07-26)

The original audit scanned ONE store. The ratchet's `PRIMITIVES`/`OWNERS` pair covered
`lib/agent-registry.ts` only, so **teams, groups, persisted sessions, tasks and governance tokens had
no guard at all** and **26 further sensitive-mutation sites were invisible**. Generalising the guard
to a per-store table (same scanner, same regex, `owners` kept minimal so no existing call site is
blessed) gives the real surface:

| store | sites | note |
|---|---|---|
| agent-registry | 11 | the original audit |
| team-registry | 9 | **3 are API ROUTES writing the store directly** |
| group-registry | 5 | no `ChangeGroup` pipeline exists |
| session-persistence | 5 | the store whose unwatched write caused KERM18NX |
| task-registry | 6 | `github-project.ts` mirror + `teams-service` writes |
| aid-token | 1 | a route MINTING a governance token outside any pipeline |

**The count is not one backlog — it is two, and they need different fixes:**

- **(a) SECOND PATH** (all 11 agent-registry sites): an all-in-one EXISTS and the call goes around
  it. Fix = route through the pipeline. Cheap, mechanical, removes a pin each time.
- **(b) UNGATED SOLE PATH** (the other 26): the only path, but the performer is not an all-in-one.
  R50 is violated differently — not "two paths" but "the one path is not a pipeline". Fix = BUILD
  the AIO (`ChangeGroup`, `ChangeTeam`, `ChangeTask`), then move the call inside it. This is design
  work, not a re-route, and it is why the number cannot simply be driven to zero by editing imports.

Category (b) reads as harmless — *of course the owning service writes its own store* — right up
until a second caller appears and turns it into (a) with no gate anywhere in between. That is
precisely how the agent-registry list reached eleven.

NEXT ACTION unchanged in kind, re-ranked by severity across the full set:
1. `app/api/v1/auth/token/route.ts::issueGovernanceToken` — the thing it hands out is AUTHORITY, and
   it is minted outside any pipeline. Highest value single row.
2. The 3 team API routes writing `saveTeams`/`updateTeam` directly — exactly the shape R50.2/R50.3
   forbid: the button's endpoint is supposed to BE the pipeline.
3. `services/sessions-service.ts::deleteAgentBySession` — the original next action; a DELETE outside
   the pipeline, same shape as the defect already diagnosed.

## The 11 bypasses (2026-07-25 audit)

**Deletes — highest severity.** A delete outside `DeleteAgent` leaves the registry row gone while
every other store still claims the agent, which is exactly the ghost-producing state.

| Call site | Should route through |
|---|---|
| `services/sessions-service.ts::deleteAgentBySession` (×2 call sites) | `DeleteAgent` |

**Creates.** A create outside `CreateAgent` skips G03 workdir policy, G05 `.claude/` seeding, G05b
DEP rules, G05c git-exclude, R17 core-plugin install, and the AMP keypair provision — so the agent
exists but is not governed.

| Call site | Notes |
|---|---|
| `services/agents-core-service.ts::createAgent` | session-discovery auto-registration |
| `services/sessions-service.ts::createAgent` | same, from the sessions path |
| `services/agents-docker-service.ts::createAgent` | container agents |
| `services/amp-service.ts::createAgent` | AMP auto-registration of an unknown sender |
| `services/help-service.ts::createAgent` | help/assistant agent |
| `services/creation-helper-service.ts::createAgent` | Haephestos |

**Direct registry writes.** `saveAgents()` is the store's own write path; a service calling it
mutates agent state with no gate and no post-condition.

| Call site | Notes |
|---|---|
| `services/agents-docker-service.ts::saveAgents` | |
| `services/agents-repos-service.ts::saveAgents` | |
| `services/agents-transfer-service.ts::saveAgents` | import/export |

**Also `services/sessions-service.ts::renameAgentSession`** — a rename outside `ChangeName`.

## Proposed fix

Per call site, in severity order (deletes → creates → direct writes):

1. Identify which all-in-one owns the operation (`DeleteAgent`, `CreateAgent`, `ChangeName`, or a
   narrower `Change*`).
2. Replace the primitive call with a call to it, passing an appropriate auth context.
3. If the all-in-one cannot express the caller's need, that is a **gap in the all-in-one** — extend
   it (a new option or gate) rather than keeping the bypass. Adding an option to one function is the
   whole point; a second function is what R50 forbids.
4. Delete the entry from `KNOWN_BYPASSES` in the ratchet test. The test fails if a converged entry is
   left in the list, so the pin cannot silently loosen.

Auto-registration (`agents-core-service`, `sessions-service`, `amp-service`) is the subtle group: it
creates an agent for a session that ALREADY exists, so `CreateAgent`'s session-creating gates must be
skippable — likely a `discoveredSession: true` mode rather than a separate function.

## Verification

- `tests/unit/all-in-one-single-path.test.ts` — count drops with each conversion, never rises.
- Existing per-service tests stay green (the behaviour must not change, only its route).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `… yarn test` green.

## Estimated risk

MED — these are live paths (session discovery, AMP registration, import/export). Each conversion is
independently landable and independently revertible; do them one at a time with the suite green in
between, never as one sweep.

## Acceptance

**(a) SECOND PATH — an all-in-one exists; re-route the call (11)**

- [ ] `deleteAgentBySession` call sites route through `DeleteAgent`
- [ ] The 6 `createAgent` call sites route through `CreateAgent` (with a discovered-session mode)
- [ ] The 3 `saveAgents` call sites route through the owning `Change*` pipeline
- [ ] `renameAgentSession` routes through `ChangeName`

**(b) UNGATED SOLE PATH — build the missing all-in-one first (26)**

- [ ] `issueGovernanceToken` minted inside a pipeline, not directly in the auth route (severity #1 —
      it hands out authority)
- [ ] The 3 team API routes stop writing `saveTeams`/`updateTeam` directly (R50.2/R50.3: the
      endpoint IS the pipeline)
- [ ] A `ChangeTeam`-family pipeline owns every `team-registry` mutation (9 sites)
- [ ] A `ChangeGroup` pipeline exists and owns every `group-registry` mutation (5 sites)
- [ ] Every `session-persistence` write is gated (5 sites) — DeleteAgent G05b is the only one today
- [ ] A `ChangeTask` pipeline owns every `task-registry` mutation (6 sites)

**Both**

- [ ] The ratchet's guard table covers every store holding governance-relevant state (re-audit: a
      store with no `StoreGuard` entry is invisible, which is how 26 sites hid)
- [ ] `KNOWN_BYPASSES` is empty and the ratchet asserts zero
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-25T23:51:47+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
