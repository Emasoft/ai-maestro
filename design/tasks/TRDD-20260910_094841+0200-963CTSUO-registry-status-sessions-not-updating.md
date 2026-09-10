---
trdd-id: 963CTSUO
title: Registry status and sessions never update for a created agent (general bug, not adoption-specific)
column: planned
created: 2026-09-10T09:48:41+0200
updated: 2026-09-10T09:48:41+0200
current-owner: ai-maestro-dev
assignee: ai-maestro-dev
task-type: bugfix
severity: CRITICAL
priority: 0
effort: M
labels: [bugfix, registry, boot-restore, sessions, agent-registry]
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
min-approval-requirement: none
created-by: ai-maestro-dev
release-via: none
test-requirements: [unit, integration]
runtime-targets: [macos]
impacts: [config-schema]
attempts: 0
test-failures: 0
last-test-result: not-run
last-test-at: null
implementation-commits: []
external-refs: ["design/tasks/TRDD-20260711_131006+0200-WLWHVMKT-external-workdir-adoption.md"]
---

# Registry status and sessions never update for a created agent (general bug, not adoption-specific)

## Problem

For an agent created via `POST /api/agents`, `~/.aimaestro/agents/registry.json` can
continue to report `status: offline, sessions: []` even while the agent's tmux
session is demonstrably alive (30s+) and `~/.aimaestro/sessions.json` correctly
records the session. The two stores disagree, and the registry is the store
`boot-restore-service.ts` keys on — so **a server restart can resurrect no agent
at all**, because boot-restore only restores agents it sees as ACTIVE in the
registry.

This is a **general** bug, not specific to external-workdir adoption. It was
discovered as a side effect while E2E-verifying TRDD-WLWHVMKT's external-workdir
adoption fix, but the decisive control experiment (below) shows it also affects
agents created the ordinary way, workdir under `~/agents/`.

## Evidence — the control experiment (from TRDD-WLWHVMKT's 2026-07-11 E2E run)

An agent created the ordinary way (workdir under `~/agents/`, AUTONOMOUS title,
`createSession: true`) showed:

- tmux session: **ALIVE**
- registry: **`status=offline, sessions=0`**

Identical to the adopted-agent case. So the defect is not in the adoption path —
it is in whatever writes (or fails to write) `status`/`sessions` back to the
registry after a session actually starts.

## Why this needs its own investigation (not inherited from WLWHVMKT)

TRDD-WLWHVMKT's own blocker-2 note (added 2026-09-04, re-measured against a live
host) found the symptom did **not** reproduce as originally stated on that host at
that time: 13/13 agents in `~/.aimaestro/agents/registry.json` carried a
non-empty `sessions[]` (9 offline, 2 active, 2 deleted), `sessions.json` held 16
entries, 3 live tmux sessions. That is *positive evidence against* the symptom as
originally written — but it is a single point-in-time read on one host, not a
regression test, and it does not rule out the bug recurring under the original
conditions (freshly created agent, immediately after `createSession: true`,
before any other event touches the registry).

**Two candidate cards were checked and neither fits:**

- `TRDD-13MZ7EFO` ("Reconcile registry sessions with live tmux state") —
  `column: complete`, `implementation-commits: [d34d7546]`, completed
  2026-07-07T15:48 — **four days before** the 2026-07-11 E2E run that observed
  this symptom. Cannot be the fix for a bug observed after it shipped.
- `TRDD-CHN16JXZ` — `column: human_review`, covers fleet-recovery liveness and
  boot-restore relaunch shape, not "the registry never updates immediately after
  a session starts for a newly created agent".

## Proposed investigation

1. Reproduce with a fresh `POST /api/agents` + `createSession: true` call,
   observing `registry.json` immediately after tmux confirms the session is
   alive (not after some other event has since touched the registry, which may
   be why the 2026-09-04 point-in-time read looked clean).
2. If it reproduces: find what SHOULD write `status`/`sessions` back to the
   registry on session start, and why it doesn't (or races with something that
   overwrites it).
3. If it does NOT reproduce on a clean repro attempt: `TRDD-13MZ7EFO` (2026-07-07)
   may in fact be the fix, landing between the original 2026-07-11 observation's
   root cause and now — in which case downgrade this card to a closed
   investigation note rather than an open bug, and cite the commit that proves it.

## Acceptance

- [ ] Reproduced (or definitively ruled out) on a fresh `POST /api/agents` +
      `createSession: true` call, reading `registry.json` immediately after tmux
      confirms the session alive.
- [ ] If reproduced: root cause identified and fixed; regression test added
      (create agent, start session, assert `registry.json` reflects `status`
      and non-empty `sessions[]` within a bounded wait).
- [ ] If NOT reproduced: this card closed with a citation of the commit/change
      that already fixed it (candidate: `TRDD-13MZ7EFO` / `d34d7546` — confirm
      or refute).
- [ ] `TRDD-20260711_131006+0200-WLWHVMKT-external-workdir-adoption.md` box "Boot-restore
      across a real server restart is proven end-to-end for an adopted agent" is
      re-attempted once this card's finding lands (blocked on this card per
      WLWHVMKT's own STATE block, not tracked here via `blocked-by` since this
      card is independent and does not own WLWHVMKT's lifecycle).
