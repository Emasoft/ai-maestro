---
trdd-id: YB4T4RTL
title: Converge the 11 store-primitive bypasses onto their all-in-one functions
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-25T23:51:47+0200
updated: 2026-07-25T23:51:47+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
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

NEXT ACTION: start with `services/sessions-service.ts::deleteAgentBySession` — a DELETE outside the
pipeline is the highest-severity of the eleven, and it is the same shape as the defect already
diagnosed.

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

- [ ] `deleteAgentBySession` call sites route through `DeleteAgent`
- [ ] The 6 `createAgent` call sites route through `CreateAgent` (with a discovered-session mode)
- [ ] The 3 `saveAgents` call sites route through the owning `Change*` pipeline
- [ ] `renameAgentSession` routes through `ChangeName`
- [ ] `KNOWN_BYPASSES` is empty and the ratchet asserts zero
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-25T23:51:47+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
