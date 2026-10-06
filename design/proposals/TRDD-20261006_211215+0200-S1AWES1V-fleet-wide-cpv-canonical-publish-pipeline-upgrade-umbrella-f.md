---
trdd-id: S1AWES1V
title: Fleet-wide CPV canonical publish pipeline upgrade umbrella, fleet rows outstanding
column: proposal
status: proposed
created: 2026-10-06T21:12:15+0200
updated: 2026-10-06T21:12:15+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Fleet-wide CPV canonical publish pipeline upgrade umbrella, fleet rows outstanding

## Problem
Issue 44 is the MANAGER-opened umbrella: every fleet plugin must bring its publish pipeline up to the current CPV canonical standard (directive from the USER, 2026-06-20), each run by that plugin's own Claude on its own repo, each posting a row on the issue.
## Current open ask
Per the issue thread (not a ruling): The tracking table lists eleven plugins: core, janitor, MANAGER (exemplar), chief-of-staff, orchestrator, architect, integrator, programmer, autonomous, maintainer, visual-communicator. Rows reported on the thread so far include the integrator (CPV pin v2.136.1 to v5.3.0, re-baselined and committed, not yet published). Per-repo cards remain open for chief-of-staff, integrator and visual-communicator, and the CPV canon owner noted the v3.0.0 renames left those cards unfollowable (re-point them; the four hand-apply workarounds in the pinned MANAGER comment are fixed upstream and must not be applied by hand). The MANAGER's own row is still unchecked and its CPV pin is at 2 sites on v2.136.1 against a latest of v5.3.0. The hub granted the integrator permission to post and said no hub action is owed. Re-baseline pins to an immutable tag; do not un-pin.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 44: NONE (4O8YRCBL is a different subject), umbrella thread with fleet reporting rows.
## Acceptance
- [ ] Each of the eleven plugins has a posted row with from-to pin and validate result
- [ ] Stale per-repo cards re-pointed at the renamed CPV dispatch surface
- [ ] The umbrella closes when every row is in
external-refs: Emasoft/ai-maestro issue #44 (https://github.com/Emasoft/ai-maestro/issues/44)

## Approval log
