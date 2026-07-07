---
trdd-id: CJZRB57R
title: Scenario 11th-HOUR proposals become individual TRDD-proposal files
column: complete
created: 2026-07-07T03:29:21+0200
updated: 2026-07-07T13:20:00+0200
current-owner: claude-fable-session
assignee: claude-fable-session
priority: 1
severity: MEDIUM
effort: M
labels: [scenario-infra, proposals, trdd, governance]
task-type: refactor
parent-trdd: null
npt: []
eht: []
supersedes: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
merge-strategy: squash
must-pass-tests-before-merge: true
test-requirements: [lint]
review-requirements: []
runtime-targets: [macos]
impacts: []
implementation-commits: [f992865c, b53c5134]
external-refs: []
---

# TRDD-CJZRB57R — Scenario 11th-HOUR proposals become individual TRDD-proposal files

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-07

USER-ordered 2026-07-07 (explicit directive, so authored directly as an authorized task,
not a proposal). Two deliverables:

1. **Redesign Rule 11 (11th-HOUR)** of the scenario-tester infrastructure so every
   improvement suggestion is written DIRECTLY as its own git-tracked TRDD-proposal file in
   `design/proposals/` (`column: proposal`, per `~/.claude/rules/trdd-approval-tiers.md`) —
   no monolithic `scenario_proposed-improvements_*.md`, no `CONSOLIDATED_PROPOSALS_*` monolith.
   End-of-batch emits only a lightweight `BATCH_SUMMARY_<batch_id>.md` INDEX (gitignored).
2. **Convert the pending backlog**: the un-screened proposal report files from the last runs
   (June 2026 batch: SCEN 001/002/003/012/013/015/016/020 + May stragglers 024/025/026/027 in
   `reports_dev/scenarios-runner/`) into individual TRDD-proposal files, deduped and
   actionability-checked against current code.

**▶ BOTH DELIVERABLES DONE 2026-07-07T13:20 — column: complete.**
- **Deliverable 1** (Rule-11 redesign, all surface rewrites + grep sweep) landed in
  `f992865c`.
- **Deliverable 2** (backlog conversion) landed in `b53c5134`: 65 TRDD-proposal files in
  `design/proposals/` labeled `batch-backlog-20260707` (17 by the 2 overnight forks +
  48 by 6 cold Sonnet converter agents — one per report, self-contained prompts, no fork
  inheritance), covering all 12 pending reports (scen 001/002/003/012/013/015/016/020 +
  024/025/026/027); 7 report items skipped as duplicate/already-fixed (skip logs in
  gitignored `reports/backlog-conversion/`). Kanban-touching proposals verified conformant
  to the 3-pillars 17-column design under TRDD-YUGDER9D (0 conflicts).
- Pending screening: the user reviews `design/proposals/` (grep label
  `batch-backlog-20260707`) via the standard approval flow.
- 2026-07-07T15:48:02+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.

## Touchpoints (from the 2026-07-07 fork-audit proposals-mechanism map)

- tests/scenarios/SCENARIOS_TESTS_RULES.md — purpose prose; Rule 11 output contract;
  Rule 13 phase table, state-file schema (`improvements_path` → `proposal_trdd_ids`,
  `consolidated_proposals_path` → `batch_summary_path`), cron-fire prompt, master-cleanup,
  CONSOLIDATED_PROPOSALS format section → BATCH_SUMMARY format, hard rules 5/7,
  Rule 14 "what counts as a report".
- tests/scenarios/scripts/generate-consolidated-proposals.sh — rewritten in place (same
  filename, kept so master-cleanup.sh:12 keeps working): emits BATCH_SUMMARY from the
  batch's design/proposals TRDDs instead of consolidating monolithic files.
- .claude/agents/scenario-runner.md — Phase G deliverable 2 + return-summary line.
- .claude/agents/scenario-improvement-implementer.md — input = APPROVED proposal TRDDs;
  appends `implementation-commits:` to each TRDD it lands.
- .claude/skills/run-scenarios-batch/SKILL.md + references/procedure-details.md —
  spawn prompt, aggregation, `--improve` loop (the `--improve` flag IS the user's approval
  act for this batch's P0 proposals: promote → planned → implement).
- .claude/skills/implement-scenarios-proposals/SKILL.md — discovery from design/proposals
  (pending) / design/tasks (approved); user confirmation = approval act (log line, git mv).
- Scenario bodies: SCEN-015/016/017 11th-HOUR steps (SCEN-016 also had a copy-paste
  NNN=015 defect), SCEN-024:174.
- CLAUDE.md UI-scenario section summary sentence.

## New Rule 11 proposal-file conventions (ratified here)

- Path `design/proposals/TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md`; id = 8-char
  UPPERCASE base36 via `LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 8`,
  collision-checked across design/{tasks,proposals,archived,refused}.
- `column: proposal`; `approval-tier: 2` default (3 if golden/owner-identity);
  `priority:` 0-3 ← P0-P3; `labels: [scenario-improvement, scen-<NNN>, batch-<batch_id>]`;
  `current-owner: scenario-runner`; `external-refs:` = source report path.
- Body: `## Problem`, `## Root cause`, `## Proposed fix`, `## Verification`,
  `## Estimated risk`, `## Approval log` (empty).
- Dedupe-before-author: grep design/proposals + design/tasks for the symptom first.
- Proposal TRDDs are committed BY NAME in the per-scenario commit cycle; scenario
  reports stay gitignored evidence (fixes the old Rule-13 instruction that tried to
  `git add` gitignored report files).

## Why

The monolithic report forced the user to read one giant file and hand-annotate
checkboxes, outside the ecosystem's standard TRDD approval flow. Per-proposal TRDDs are
git-tracked, greppable (`^labels:.*batch-<id>`), screenable with the existing
amama-proposal-approvals batch syntax (`approved:`/`refused:`), and each carries its own
audit trail (`## Approval log`, `implementation-commits:`).

## Notes and lessons learned
