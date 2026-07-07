---
trdd-id: KX1DWP9X
title: Decide fate of the permanently-Exited default placeholder agent in the sidebar
column: proposal
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T12:44:38+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: refactor
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-KX1DWP9X — Decide fate of the permanently-Exited default placeholder agent in the sidebar

## Problem

The sidebar shows a `default` agent that is always in the "Exited" state
(per the 5-state agent-status model documented in the project's root
`CLAUDE.md` — `programRunning === false`). It clutters the sidebar's
Active/Hibernated counts (still counts toward the total N) without being
directly useful to the user.

## Root cause

Confirmed at HEAD (2026-07-07): `~/.aimaestro/agents/registry.json`
contains an entry:
```json
"name": "default",
"workingDirectory": "/",
"sessions": [{ "index": 0, "status": "offline", ... }]
```
`workingDirectory: "/"` is itself unusual (every other agent's
`workingDirectory` is under `~/agents/<name>/` per this project's
Agent-First Architecture convention). This looks like a legacy bootstrap
entry, but it is unclear from the registry data alone whether some part
of the registry contract (e.g. a fallback agent for orphaned sessions,
or a first-run seed) still depends on its existence.

## Proposed fix

Before touching anything, grep the codebase for special-casing of the
literal string `'default'` against agent name/id (e.g. in
`lib/agent-registry.ts`, `services/element-management-service.ts`,
registry bootstrap/seed code, or any first-run initialization script) to
determine whether it is:

(a) **Vestigial** — no code depends on an agent literally named
`default` existing; in that case, remove it from the registry (via the
normal DeleteAgent UI path, respecting Rule 0's delete-with-caution
posture — confirm it doesn't own a real working directory with user data
first, especially given the unusual `workingDirectory: "/"` value), or

(b) **Load-bearing** — some fallback/orphan-session-handling code
depends on an agent named `default` existing as a sentinel; in that case,
fix its **sidebar presentation** instead of removing it: give it a
distinct label/badge (e.g. "System placeholder — not a real agent")
and exclude it from the Active/Hibernated agent counts shown to the user.

## Verification

If (a): after removal, `GET /api/agents` no longer lists a `default`
entry, the sidebar Active/Hibernated counts drop by one accordingly, and
no functional regression appears in normal agent CRUD flows (create,
list, delete another agent) across a smoke-test pass.

If (b): after the presentation fix, the sidebar clearly distinguishes the
placeholder from real agents and the Active/Hibernated counts reflect
only real, user-created agents.

## Estimated risk

UNKNOWN until the grep-first investigation above is done — this is
exactly why the proposed fix opens with "confirm before removing" rather
than prescribing outright deletion. Removing a load-bearing sentinel
without confirming its role first could break orphaned-session handling
elsewhere in the registry/session-discovery pipeline.

## Approval log
