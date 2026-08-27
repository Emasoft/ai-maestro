---
trdd-id: Q6JM2RU3
title: Team-governance scenarios must detect the MANAGER-singleton precondition at setup
column: ai_review
min-approval-requirement: none
priority: 1
severity: medium
effort: small
task-type: infra
created: 2026-07-14T20:39:44+0200
updated: 2026-08-27T21:22:00+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
current-owner: scenario-runner
created-by: scenario-runner
assignee: ai-maestro-hub-session
implementation-commits: [1649efad, 30e17c9a]
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

## Implemented — 2026-08-27, with one deliberate deviation

`tests/scenarios/scripts/assert-clean-governance.sh` (new, read-only), called from
`scenario-setup.sh` immediately after the `yq` check and **before** the backup dir is created or
any git fixture is reset, so a refused setup mutates nothing and leaves no orphan
`state-backups/` directory. Companion `list-governance-litter.sh` prints the structural litter
set (`workingDirectory` under `~/agents/` + a non-empty `governanceTitle`). Pinned by
`tests/unit/scenario-governance-audit.test.ts` (14 cases, 3 neuter runs observed).

**DEVIATION — the `scen<NNN>-*` allowlist is deliberately NOT implemented.** This card proposed
failing only when the incumbent MANAGER's name is *not* `scen<NNN>-*`. Measured against the gate
it mirrors, that is a **false pass**: Gate 7 (`services/element-management-service.ts:2699`,
`currentManagerId !== agentId`) compares **ids** and is blind to names, so a leftover
`scen030-manager` from an interrupted run has a different id than the agent SCEN-030 creates at
S003 and blocks it exactly as a foreign holder would — after setup printed OK. Allowlisting it
would re-create the precise failure this card exists to remove. Every incumbent now fails; only
the guidance text differs (leftover-from-this-scenario / foreign holder / stale unregistered id).
Reviewed by the fable advisor, which independently identified the same false pass.

**Also corrected against measurement:** the card's `~2249-2260` citation for Gate 7 had drifted —
the site is `:2697-2704`. And the predicate for "does this scenario create a MANAGER" is a body
grep, not a frontmatter read: `data_produced:` **under**-fires (SCEN-005 declares "3 test agents",
SCEN-024 declares "scen024-mgr-01" — neither string contains MANAGER, both take the singleton) and
`subsystems: governance` **over**-fires on 8 scenarios that never assign a title while missing
SCEN-022. Grepping for MANAGER co-occurring with a title/create/assign/promote verb fires on
exactly 20 of the 40 scenario files, and whole-file vs body-only was measured identical.

## Acceptance

- [x] Precondition audit exists on the shared setup path, one place for all scenarios
      (`tests/scenarios/scripts/assert-clean-governance.sh`, wired into `scenario-setup.sh`).
- [x] It runs before any state mutation — established by EXECUTION, not by reading line order:
      `bash tests/scenarios/scripts/setup-SCEN-030.sh` on this host exits 1 carrying the audit's
      own `SETUP_FAIL` text (so the wrapper's `$(dirname "$0")` really resolves — a bad path would
      also abort under `set -e`, but at exit 127 with a different message), and the
      `state-backups/` directory count is unchanged across the run (190 → 190).
- [x] On a host with a pre-existing foreign MANAGER, a MANAGER-creating scenario's setup exits
      non-zero with `SETUP_FAIL pre-existing-MANAGER <name> (<id>)` — verified against this host's
      REAL incumbent `testbot`. Live coverage is the foreign-holder and skip paths only; the
      leftover-`scen<NNN>`, unregistered-id and corrupt-file branches are fixture-driven, since
      reaching them live would mean mutating the host's governance state.
- [x] On a free singleton, it exits 0 with `GOVERNANCE_AUDIT_OK` and setup proceeds (fixture).
- [x] A scenario that never assigns the MANAGER title is skipped and setup runs on normally —
      `setup-SCEN-027.sh` end-to-end reaches `SETUP_OK` and writes its backup dir — and the skip
      line still names the incumbent, so a future unmatched phrasing leaves evidence in the log.
- [x] It never demotes or deletes anything (Rule 6): read-only, guidance only.
- [x] `list-governance-litter.sh` prints the structural litter set; verified live (2 rows,
      `manager*` marking the singleton holder).
- [x] Failure modes are closed, not lenient: corrupt `governance.json` fails setup rather than
      reading as "no manager"; a `managerId` no registry row carries fails as `<unregistered id>`.
- [x] Pinned by tests, with four neuters observed: allowlist restored → 1 red; lenient corrupt-read
      → 1 red; predicate skip branch removed → 4 reds (predicted 1 — the observation is what is
      recorded); verb requirement dropped from the predicate → 2 reds, SCEN-019/SCEN-027 staying
      green. That last run is what shows the corpus cases are separable rather than one assertion
      wearing three names — and also that SCEN-020 is the only load-bearing one of the three.
- [x] Gates green: `tsc --noEmit` 0 · `yarn lint` 0 · `yarn test` 6511 passed / 492 files ·
      `yarn pillars:lint` 0 · `trddgrep validate` unchanged at its 271 pre-session findings.

## Approval log

- 2026-08-21T22:36:05+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: none). Re-measured: still unimplemented — `tests/scenarios/scripts/scenario-setup.sh` has no pre-existing-MANAGER check, and no `assert-clean-governance.sh` / `list-governance-litter.sh` exists anywhere under `tests/scenarios/scripts/`. Premise still holds; approved.
