---
trdd-id: 74ZS7P9U
title: web-scenario-tester — token-optimized restructure (per-phase skills, split agents, greppable steps, lean wrappers, validator)
column: completed
created: 2026-06-25T00:11:07+0200
updated: 2026-07-10T05:45:23+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
task-type: feature
release-via: publish
publish-target: ai-maestro-plugins
published-version: 0.1.3
published-at: 2026-07-08T18:48:08+0200
parent-trdd: TRDD-f181a4ae
relevant-rules: []
labels: [scenario-testing, plugin, token-economy, dev-browser]
external-refs: []
---

# TRDD-74ZS7P9U — web-scenario-tester token-optimized restructure

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-06-25

**What:** improve the `web-scenario-tester` plugin (separate repo `~/Code/ai-maestro-web-scenario-tester/`) per a USER work-order: per-phase skills, split agents, greppable per-step scenario reading, lean tool-output wrappers, a scenario validator, and README scenario-rules docs. NOT publishing — the USER will open a session in the plugin folder to publish + register on `ai-maestro-plugins`.

**Approach (load-bearing):** build in the `/tmp` clone `/tmp/wst-edit` (rule-compliant for me AND any helper agents — `~/Code/` is outside project+/tmp), commit each unit, then SYNC into `~/Code/ai-maestro-web-scenario-tester/` at the end so the USER's publish session finds it ready. NO push, NO publish. Subagents (if any) may only write `/tmp` (IRON rule) — so they build in `/tmp/wst-edit`; the main agent does the final sync.

**Gotcha (cost a hang):** the canonical TRDD `while ls design/tasks/TRDD-*-$TID-*.md; do …; done` collision loop HANGS in this zsh config (a non-matching glob still makes `ls` exit 0 → infinite loop, 8-min timeout observed). Use `ls design/tasks/ | grep -c "$TID"` for collision checks instead.

**Current plugin baseline (verified 2026-06-25):** 7 `amwst-` skills, 5 agents, 8 scripts; scenario format `.scen.md` (`#### S<NNN>:` steps with Action/Goal/Creates/Modifies/Verify; `## Phase N:`) — already step-greppable. The runner (`amwst-scenario-runner`, 265 lines) is a MONOLITH: run + fix-as-you-go + report + 11th-hour proposals in one agent. The plugin has NO lean wrapper, NO region-capture, NO step-batch, NO step-extractor, NO validator. ai-maestro HAS portable versions: `scenario-region-capture` skill, `scenario-step-batch` skill, `tests/scenarios/scripts/lean/leantool.py`.

**NEXT ACTION:** DONE — all phases P2-P8 complete. The restructure is committed in `/tmp/wst-edit` (9 commits, base `16620ea` → HEAD `cd68adb`) AND fast-forward-synced into `~/Code/ai-maestro-web-scenario-tester/` (clean tree, HEAD `cd68adb`). CPV `remote_validation` strict on the synced tree: **CRITICAL=0 MAJOR=0 MINOR=2 NIT=0**. The 2 residual MINORs (no pre-push hook, no `.github/workflows`) are PRE-EXISTING publish infra the canonical `publish.py` scaffolds — out of scope per "don't publish". The USER's publish session can proceed in the plugin folder. (Follow-up: the ai-maestro copy `tests/scenarios/scripts/lean/leantool.py` got the same ruff fix for consistency.)

## The USER work-order (8 requirements)

1. Provide the necessary skills + helper scripts for the main agent.
2. A skill specialized in EACH phase of a scenario run, so the agent reads only the one it needs.
3. Proposals/suggestions management and fix-as-you-go must be run by **2 DIFFERENT agents**, not the same one.
4. Reading the `.scen.md` must be greppable per-step — the agent reads/greps only the step it's on, not the whole file each turn.
5. All other scripts optimized to filter tool outputs.
6. Each helper needs a skill to use it, and the agent must know WHEN to use it.
7. Add a skill to write a scenario (already exists: `amwst-create-scenario`) + a SCRIPT to validate it.
8. Document the scenario rules well in the plugin README + other info. (Do NOT publish — USER does that.)

## Plan

### New scripts (author by hand — executables; `scripts/`)
- `amwst-leantool.py` — port leantool.py: `tsc|eslint|vitest|pytest|log` subcommands, errors-only output, exit-code faithful, never swallows a failure. (req 5; techniques 4+7)
- `amwst-scenario-step.sh` — `<file> list` → step ids; `<file> S<NNN>` → that one step's block (`#### S<NNN>` → next `####`/`##`). (req 4)
- `amwst-validate-scenario.py` — validate a `.scen.md`: frontmatter required keys, sequential `S<NNN>`, each step has Action/Goal/Verify (+Creates/Modifies), Phase 0 SAFE-SETUP + a CLEANUP phase present, greppable boundaries. (req 7)

### New skills (`skills/`)
- `amwst-region-capture` — port ai-maestro `scenario-region-capture` (+ `references/region-capture.js`). (req 1; technique 5)
- `amwst-step-batch` — port ai-maestro `scenario-step-batch` (+ references). (req 1; technique 1)
- `amwst-phase-execute` — the per-step loop: greppable step reading via amwst-scenario-step.sh, snapshot discipline, region-capture, step-batch, sudo handling, load order. (req 2)
- `amwst-phase-fixasyougo` — diagnose-on-failure: scoped reads + `amwst-leantool.py log`/`tsc`/…, fix→rebuild→retry. (req 2+3)
- `amwst-phase-proposals` — Rule 11 11th-hour analysis + proposal writing, for the SEPARATE proposer agent. (req 2+3)
- `amwst-validate-scenario` — when/how to run amwst-validate-scenario.py. (req 7)

### New agent (`agents/`)
- `amwst-scenario-proposer` — the SEPARATE 11th-hour proposals agent (loads `amwst-phase-proposals`); reads the run report + scenario, writes the proposals file. Distinct from the runner. (req 3)

### Refactor
- `amwst-scenario-runner` — slim to run + fix-as-you-go + report; load phase skills on demand; STOP writing 11th-hour proposals (hand off). Reference the new scripts/skills + a Token-discipline section (mirrors the main-agent one).
- `web-scenario-tester-main-agent` — rewire run flow to the 2-agent sequence (runner → proposer); list the new skills/scripts + WHEN to use each. (req 6)
- `amwst-run-scenario` / `amwst-run-scenarios-batch` — orchestration: the runner→proposer 2-agent handoff.
- `amwst-create-scenario` / `amwst-edit-scenario` — reference the validator + greppable-step format.

### Docs
- `README.md` — a well-documented "Scenario rules" section (summary of the rules) + the new skills/scripts + when-to-use + the greppable step format + the validator.

## Execution phases
- [x] P2 — 3 scripts authored + tested (`c24570f`): `amwst-leantool.py` (tsc/eslint/vitest/pytest/log, ruff-clean, SELFTEST PASS), `amwst-scenario-step.sh` (list/phases/S<NNN>), `amwst-validate-scenario.py` (frontmatter+phases+steps; examples validate 0/0).
- [x] P3 — ported 2 helper skills (`89c076d`): `amwst-region-capture` + `amwst-step-batch` (de-referenced; JS `node --check` OK).
- [x] P4 — 3 phase skills + validate skill (`ffe9112`): `amwst-phase-execute` / `-fixasyougo` / `-proposals` (load-on-demand) + `amwst-validate-scenario`.
- [x] P5 — proposer agent + runner refactor (`2c9ab98`) + orchestration rewire (`00fe41a`): `amwst-scenario-proposer` (separate 11th-hour agent); runner token-disciplined, loads phase skills on demand, writes ONLY the report; `amwst-run-scenario` + `amwst-run-scenarios-batch`(+procedure-details) spawn runner→proposer; main-agent tooling map; create/edit-scenario validate step.
- [x] P6 — README (`7553f10`): "The skills" (13), 2-agent flow, helper scripts, the 14 scenario-rules table.
- [x] P7 — CPV `remote_validation` strict GREEN (`e1cac6f`): CRITICAL=0 MAJOR=0 MINOR=2 NIT=0 (started 2 MAJOR / 3 MINOR / 3 NIT; fixed leantool ruff, the skill/script false-positive, pyproject + version-sync, NIT rewords, 3 Done-when checklists). 2 residual MINORs = pre-existing publish infra the pipeline owns.
- [x] P8 — synced `/tmp/wst-edit` → `~/Code/ai-maestro-web-scenario-tester` via FF pull (HEAD `cd68adb`, clean). No push, no publish — USER's session does that. `.gitignore` updated for `uv.lock` + py artifacts (`cd68adb`).

## Approval log

- 2026-07-10T05:45:23+0200 — COMPLETED, archived. Shipped in `web-scenario-tester` v0.1.3
  (released 2026-07-08T16:48:08Z). Verified against the repo rather than a STATE block:
  `cd68adb...v0.1.3` compares `behind=0`, so this restructure's HEAD is an ancestor of the
  tag, and the tag's own tree carries its distinguishing artifacts — the split-agent
  `amwst-scenario-proposer`, 14 skills, `pyproject.toml`, `.python-version`. No approver is
  named because none exists: the work finished and the archival step was simply missed.
  Bookkeeping by ai-maestro-session (EXEMPT category A/E).
