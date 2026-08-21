---
trdd-id: 9Z2P2SDA
title: Phase-3 scenario — dashboard MAINTAINER creation observes ChangeTitle G15/G16 report installed
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-18T20:19:21+0200
updated: 2026-08-22T01:24:59+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: medium
effort: S
labels: [scenario, phase-3, fleet, role-plugins, TRDD-BRRJK57P]
external-refs: [TRDD-BRRJK57P, TRDD-JT3U4ZVM]
---

# Phase-3 scenario — MAINTAINER title creation observes G15/G16 `installed`

## Problem

TRDD-JT3U4ZVM closed 8 of 9 acceptance boxes; the ninth is the ONLY evidence class the whole
fix never produced: a live observation of the ChangeTitle pipeline reporting
`G16: installed` (not `WARN — Failed to install`) when a MAINTAINER title is assigned through
the dashboard. Tags on the repos and a successful CLI install are necessary and not
sufficient — the pipeline's own gate line is what the card promised. The live server was DOWN
(curl 000, 2026-08-18) whenever a runner could have observed it.

This is the first Phase-3 scenario under the USER mandate (TRDD-BRRJK57P goal 3): short,
multi-phase, run against the live ai-maestro server, covering a fixed bug.

## Proposed scenario (author per SCENARIOS_TESTS_RULES.md — this card tracks it, the .scen.md
file is the deliverable)

Phases: (0) SAFE-SETUP + server up + baseline screenshot · (1) create a test agent via the
wizard (`scen-` prefix, workdir under ~/agents/) · (2) assign the MAINTAINER title through the
UI, sudo modal per Rule 12 (env var NAME only, never the literal) · (3) VERIFY: the ChangeTitle
ops trace reports `G15/G16: installed` — read-only, from the pipeline result the UI surfaces
and/or the agent's registry entry; screenshot · (CLEANUP) delete the agent via the UI with
folder deletion, purge cemetery, STATE-WIPE.

## Acceptance

- [ ] A `SCEN-XXX_maintainer-title-g16.scen.md` exists, conforms to the 15 rules, and names this
      card.
      **⚠ VERIFY THE PREMISE BEFORE WRITING IT — measured 2026-08-22, and it does not hold as
      stated.** This card's title says *"dashboard MAINTAINER **creation** observes **ChangeTitle**
      G15/G16"*, and those are two different pipelines. `G15`/`G16` are emitted **inside
      `ChangeTitle`** (`services/element-management-service.ts`: `ChangeTitle` at :2481, the gates
      at :3851-3881). Wizard **creation** runs `CreateAgent`, which has its own gate series; the
      only creation-side route into `ChangeTitle` I found is **`PG04`** (:1488), a *repair* for a
      titled agent that LOST its role-plugin — not the normal path. **So a scenario that merely
      CREATES a MAINTAINER through the wizard may observe nothing, and would pin nothing** — the
      exact "test that passes for an unknown reason" failure. Settle it first: either drive a
      title CHANGE (SCEN-001's shape) so `ChangeTitle` genuinely runs, or prove that creation
      reaches G15/G16 and record the file:line that shows it.
      **And do NOT author a new fixture blindly:** `SCEN-018_maintainer-lifecycle` ALREADY stands
      up a MANAGER plus a MAINTAINER with `ai-maestro-maintainer-agent` through the wizard, and
      `SCEN-001_title-change-lifecycle` already drives title changes and verifies role-plugin
      installs via the Config tab. If the observation can be added as a step to one of those, that
      is a far smaller change than a 41st scenario file — this box's "a new SCEN file exists" was
      written before either was checked.
- [ ] The scenario has RUN against the live server; the G15/G16 `installed` observation is
      recorded (report + screenshot), or the failure is a bug card.
- [ ] TRDD-JT3U4ZVM's last box is ticked citing that run, and that card leaves `blocked`.

## Approval log

- 2026-08-18T20:19:21+0200 — MANDATE under the USER's recorded delegation (TRDD-BRRJK57P
  Approval log). Tier 0 in-repo scenario authoring.
