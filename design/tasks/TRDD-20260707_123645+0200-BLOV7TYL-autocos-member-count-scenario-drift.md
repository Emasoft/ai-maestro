---
trdd-id: BLOV7TYL
title: Auto-COS member count confuses SCEN-002 Edit Team modal assertions
column: planned
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-BLOV7TYL — Auto-COS member count confuses SCEN-002 Edit Team modal assertions

## Problem
SCEN-002 S041/S042 expected the Edit Team modal's member-selection count to
show 2 selected (alpha+beta) and drop to 1 after deselecting alpha. Actual
observed behavior: 3 selected (alpha+beta+auto-created COS agent, e.g.
"Aindrea") dropping to 2 after deselect. The auto-COS agent is a full
`team.agentIds` member (per the CreateTeam pipeline's auto-COS creation
documented in `tests/scenarios/SCENARIOS_TESTS_RULES.md` "Auto-COS creation
on team creation" authoring note), so the counts the app shows ARE correct —
the scenario was authored before the auto-COS behavior existed and never
updated its expected counts.

## Root cause
Pure scenario-authoring drift: SCEN-002 predates (or was never updated
after) the CreateTeam pipeline's auto-COS-agent creation feature, which adds
one extra `agentIds` member (the auto-created Chief-of-Staff) beyond the
explicitly-selected member agents.

## Proposed fix
1. Update `tests/scenarios/SCEN-002_*.scen.md` steps S041/S042/S046
   expected counts to be COS-inclusive: N selected members + 1 auto-COS =
   N+1 total, dropping to N after one deselect. Do not hardcode the
   auto-COS's persona name (it is randomly generated per the
   SCENARIOS_TESTS_RULES.md note) — derive it from `team.chiefOfStaffId` in
   the verification step instead.
2. Optional UX improvement (not required to close this proposal, but noted
   since it would make the count self-explanatory to a human user, not just
   to the scenario): in the Edit Team modal's member list, visually
   distinguish the COS row with a "COS" badge and make it non-deselectable,
   reinforcing R4.7's `agentIds`-removal protection so the count is
   self-explanatory without reading the pipeline internals.

## Verification
1. Re-run SCEN-002 S041/S042/S046 with the COS-inclusive expected counts —
   result should be PASS, not the current adapted/deviating observation.
2. If the optional UX badge is implemented: the COS row shows a "COS" badge
   and resists deselection in the Edit Team modal.

## Estimated risk
LOW. The mandatory fix is scenario-file-only (no code change). The optional
UX badge is a small additive UI change with no functional impact on the
underlying `agentIds`/`chiefOfStaffId` model.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
