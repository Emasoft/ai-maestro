---
trdd-id: Q6JM2RU3
title: Team-governance scenarios must detect the MANAGER-singleton precondition at setup
column: proposal
approval-tier: 2
priority: 1
severity: medium
effort: small
task-type: infra
created: 2026-07-14T20:39:44+0200
updated: 2026-07-14T20:39:44+0200
current-owner: scenario-runner
labels: [scenario-improvement, scen-030]
relevant-rules: [7]
external-refs: [reports/scenarios-runner/SCEN-030_20260714T181702Z.report.md]
---

## Problem

SCEN-030 STUCK at S003: it must create `scen030-manager` holding the MANAGER
title, but MANAGER is a hard per-host singleton and the host already had a
leftover MANAGER (`jack-bot`, litter from a prior interrupted run). Nothing in
`setup-SCEN-030.sh` / `scenario-setup.sh` detects this, so the scenario silently
walks into an unrecoverable wall at the first fleet-building step. This is not
specific to SCEN-030 — every scenario that creates a MANAGER (and, by the same
per-team logic, ORCHESTRATOR/COS singletons) inherits the same latent trap on any
non-pristine host.

## Root cause

The MANAGER singleton is enforced in `services/element-management-service.ts`
Gate 7 (lines ~2249-2260): ChangeTitle → MANAGER is rejected with
`Only one MANAGER allowed. "<holder>" already holds this title.` when
`getManagerId()` returns a different agent. The scenario setup contract (Rule 7)
backs up config but performs no precondition audit, so the conflict surfaces only
mid-run as an un-actionable UI block — and by then a forked runner may not have
the budget to demote the incumbent and still finish + clean up.

## Proposed fix

Add a precondition audit to the shared setup path (one place, all scenarios).
- File: `tests/scenarios/scripts/scenario-setup.sh` (or a new
  `assert-clean-governance.sh` it sources).
- For any scenario whose frontmatter `subsystems:` includes `governance` and
  whose steps create a MANAGER, read `~/.aimaestro/governance.json` `managerId`
  and `registry.json`; if a MANAGER exists whose name is NOT `scen<NNN>-*`, emit:
  `SETUP_FAIL pre-existing-MANAGER <name> (<id>) — free the singleton before running; run the litter-cleanup or delete <name> via the UI`.
- Optionally, a companion `tests/scenarios/scripts/list-governance-litter.sh` that
  prints every `~/agents/*` agent carrying a governanceTitle+role-plugin (the
  structural litter test from SCENARIOS_TESTS_RULES.md 2026-07-14) so the operator
  can clear them once, deliberately, via the UI.

Do NOT auto-demote/delete inside setup — that would be a state-mutating,
non-UI action (Rule 6). Fail-fast with guidance instead.

## Verification

- On a host with a pre-existing non-scen MANAGER, `setup-SCEN-030.sh` exits
  non-zero with the `SETUP_FAIL pre-existing-MANAGER` line and the scenario does
  not start (Rule 7).
- On a pristine host (or after the operator clears the incumbent), setup exits
  `SETUP_OK` and S003 proceeds.

## Estimated risk

LOW. Additive read-only audit in the setup script; no product code change.
Dependency: agreement on the litter policy (SCENARIOS_TESTS_RULES.md already
grants standing permission to delete governance litter under `~/agents/`).

## Approval log
