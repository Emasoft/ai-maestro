---
trdd-id: ZLJO8G32
title: Make SCEN-013 client-aware so the Codex variant stops inheriting Claude-only assumptions
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-013, batch-backlog-20260707]
task-type: docs
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_013_20260623T115232Z.md"]
---

# TRDD-ZLJO8G32 — SCEN-013 client-aware refresh (Codex paths, counts, R9.13)

## Problem

`tests/scenarios/SCEN-013_r17-core-plugin-codex.scen.md` was forked from the Claude
SCEN-012 without adapting client-specific steps: S017/S023/S027 read/edit
`~/agents/<name>/.claude/settings.local.json`, which DOES NOT EXIST for a Codex agent (the
Codex install record is `.codex/installed-plugins/ai-maestro-plugin.json`); S018 expects
"Skills 12 and Commands 12" (actual: "Skills 34", no Commands count for Codex); S013/S014
wording predates R9.13's mandatory auto-assigned `ai-maestro-autonomous-agent` role-plugin.
The 2026-06-23 run passed only because the runner manually adapted every divergence.
(Verified 2026-07-07: the file still carries the deprecated `required_tools:` frontmatter
too.)

## Root cause

Scenario authored pre-R9.13 and never adapted to the Codex install model.

## Proposed fix

Edit the scenario: S017/S023/S027 verify the client-native install record
(`.codex/installed-plugins/ai-maestro-plugin.json`; presence = installed) with generic
wording; S018 drops hardcoded counts (assert "Plugins 1" + core label only); S013/S014
reworded to the R9.13-mandated role-plugin; replace `required_tools:` with
`browser_stack: dev-browser`; add a pre-flight note that a leftover registry-only orphan
from a prior run must be UI-deleted before the wizard accepts the name. Note the "disable"
simulation depends on TRDD-5681KM4Z (Codex disabled-representation definition).

## Verification

`grep -n "settings.local.json" SCEN-013_*.scen.md` returns 0; a fresh runner needs no
manual adaptation; each Verify line matches the Codex install model.

## Estimated risk

LOW — scenario doc only.

## Approval log
