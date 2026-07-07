---
trdd-id: GBYMRL2K
title: Refresh SCEN-020 spec for the mandatory MAINTAINER repo field and the Role-section UI
column: planned
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-020, batch-backlog-20260707]
task-type: docs
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_020_20260625T153541Z.md"]
---

# TRDD-GBYMRL2K — SCEN-020 spec refresh (MAINTAINER repo field + Role section)

## Problem

Two authoring drifts in `tests/scenarios/SCEN-020_core-plugins-unchangeable.scen.md`
(verified 2026-07-07 — the file mentions neither): (1) S012 does not mention that selecting
MAINTAINER reveals a MANDATORY "GitHub Repository (owner/repo)" field (R19.3) whose absence
keeps Confirm disabled — a runner following S012 verbatim STALLS at "Confirm disabled";
(2) S009/S010 describe a per-row green "role" badge inside the Plugins list, but the
role-plugin now lives in a dedicated "Role"/"ROLE PLUGIN" Config section whose only control
is a "Change" button (no uninstall) — the intended title-lock evidence moved.

## Root cause

The scenario predates (a) the R19.3 per-repo-MAINTAINER constraint being surfaced as a
required dialog field and (b) the role-plugin extraction into its own Config section.

## Proposed fix

Edit the scenario file: S012 Action gains "When MAINTAINER is selected, a 'GitHub
Repository' field appears (R19.3); fill `Emasoft/scen020-test-repo` — Confirm stays
disabled until provided — then Confirm + sudo modal", and `data_produced` notes the
githubRepo binding (cleared at delete). S009/S010 Goal/Verify are rewritten to the Role
section ("required" badge, "N options" picker, only a "Change" button — removal goes via
ChangeTitle Gate 15, never direct uninstall).

## Verification

A fresh runner following the revised steps reaches the sudo modal without stalling and
finds the title-lock evidence where the spec points.

## Estimated risk

LOW — scenario doc only.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
