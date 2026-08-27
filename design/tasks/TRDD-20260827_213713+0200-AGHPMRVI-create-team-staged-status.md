---
trdd-id: AGHPMRVI
title: Create Team dialog shows a binary spinner for 30-60s while the auto-COS and its role-plugin are built
column: planned
created: 2026-08-27T21:37:13+0200
updated: 2026-08-27T21:37:13+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-27T21:37:13+0200
derived: true
derived-kind: eht
parent-trdd: JU6Y2V7X
priority: 2
severity: minor
effort: medium
labels: [scenario-improvement, scen-001, ui]
---

## Problem

`components/teams/TeamCreationWizard.tsx` (~:1057) renders a single `Creating...` label with a
spinner for the whole CreateTeam pipeline. On a real host that pipeline takes **30-60 s**: it
creates the team, creates the auto-COS agent, and installs `ai-maestro-chief-of-staff` at that
agent's local scope. The team and COS are in `teams.json` long before the dialog closes, so with
no progress detail the state is indistinguishable from a hang — and a scenario runner that gives
up mid-wait leaves a half-built team on the host (SCEN-001, 2026-07-29 run).

## Root cause

A synchronous create path doing network work behind a binary spinner. The pipeline already
emits a per-gate ops log; nothing carries it to the dialog.

## Proposed fix

Give the dialog a staged status ("creating team… creating chief-of-staff… installing
role-plugin…") sourced from the same pipeline the ops log already emits. This needs a progress
channel from the create pipeline to the dialog — the reason it is a separate card from
`TRDD-JU6Y2V7X` rather than a line in it: the parent card's other two items were pure scenario
authoring and shipped in one commit; this one touches the pipeline/UI seam and its own risk
rating is LOW-MED.

## Verification

Create Team's dialog text changes at least twice before it closes.

## Acceptance

- [ ] The dialog's status text changes at least twice during a real CreateTeam.
- [ ] The stages named correspond to real pipeline gates, not a timer.
- [ ] A test pins that the status is sourced from the pipeline (a stub pipeline emitting two
      stages produces two distinct labels), with a neuter run recorded.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Split out of TRDD-JU6Y2V7X on implementation: that card's items (1)+(2) were scenario
  authoring and landed; this item is a feature with a pipeline seam and is scoped on its own.
