---
trdd-id: 91TLL7DW
title: Kernel-attested identity is void on any route that takes the acting agent from a request parameter
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:18:32+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, agent-auth, api]
external-refs: [TRDD-EVO7T245, TRDD-NWTTU0AQ, TRDD-V2BLADSF, TRDD-RC33OAFQ]
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

- [ ] Route inventory with the identity source for each.
- [ ] Every parameter-sourced route has a named authorization check.
- [ ] A guard test reddens when a new route reads an agent id unchecked.
