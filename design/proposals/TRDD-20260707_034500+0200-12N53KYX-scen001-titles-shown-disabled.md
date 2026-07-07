---
trdd-id: 12N53KYX
title: Update SCEN-001 wording — standalone-title dialog shows team titles disabled, not hidden
column: proposal
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T03:45:00+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-001, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_001_2026-06-23T08-44-04Z.md"]
---

# TRDD-12N53KYX — SCEN-001 wording: titles shown-disabled, not hidden

## Problem
SCEN-001 S015/S016 expect only AUTONOMOUS/MANAGER/MAINTAINER to be "visible" in the
Title Assignment Dialog for a no-team agent. The current (correct, arguably better) UI
shows ALL 8 titles and DISABLES the team-requiring ones with the reason text "Requires
team membership. Assign this agent to a team first." Every run re-derives this same
ADAPTED verdict.

## Root cause
Scenario authored against an older hide-titles UX; the UI evolved to show-with-disable.

## Proposed fix
Edit `tests/scenarios/SCEN-001_title-change-lifecycle.scen.md` S015/S016 to expect: all
titles rendered; AUTONOMOUS + MAINTAINER selectable; MEMBER/CHIEF-OF-STAFF/ORCHESTRATOR/
ARCHITECT/INTEGRATOR disabled with the team-membership reason; MANAGER disabled
(singleton — names the current holder). Bump the scenario `version:`.

## Verification
Next SCEN-001 run: S015/S016 PASS as written (no ADAPTED).

## Estimated risk
LOW — scenario file only. Dependencies: none.

## Approval log
