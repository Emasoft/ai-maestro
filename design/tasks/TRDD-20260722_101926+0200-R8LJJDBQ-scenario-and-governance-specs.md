---
trdd-id: R8LJJDBQ
title: Author the governance and scenario-tests SPEC files by capturing their rule files rule-by-rule
column: complete
created: 2026-07-22T10:19:26+0200
updated: 2026-07-22T10:36:00+0200
current-owner: ai-maestro
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T10:19:26+0200
relevant-rules: []
labels: [governance-rules, design-doc-taxonomy, specs-folder, governance-spec, scenario-tests-spec, web-scenario-tester]
external-refs: [Emasoft/ai-maestro#85, TRDD-P58RCR2C]
parent-trdd: P58RCR2C
release-via: none
implementation-commits: [2096ad35]
---

# Author the governance and scenario-tests SPEC files by capturing their rule files rule-by-rule

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-22

- **DONE.** Both SPEC files authored, verified, in `design/specs/`.
  - `design/specs/governance-spec.md` (spec-version 1.0.0, 856 lines) — captures
    `docs/GOVERNANCE-RULES.md` v4.5.0 clause-for-clause: every rule R1-R49 + sub-rule, the 22
    invariants, the comm-graph (machine-parseable `@spec:comm-graph` block), the 8 titles +
    `@spec:title-plugin-map`, the permission matrix, the IND/DEP boundary (governance = DEP), and a
    `GOV-VAL` conformance checklist.
  - `design/specs/scenario-tests-spec.md` (spec-version 1.1.0, 357 lines) — captures
    `tests/scenarios/SCENARIOS_TESTS_RULES.md` (Rule 0-14) atomically (124 sub-clauses) + the
    runner-agent contract (`STS-RUN`) + the test procedures (`STS-PROC`) + the scenario-file format
    (`STS-FILE`) + the `STS-VAL` self-validation checklist for the web-scenario-tester plugin.
- **KEY METHOD (USER correction, load-bearing):** a SPEC is written by reading the WHOLE rule file
  ONE RULE AT A TIME and is MORE detailed than the rule file — NEVER a summary/digest. "Concise/dry/
  greppable" is the per-clause STYLE, not permission to omit content. A first cut delegated the
  governance distillation to a Sonnet summariser; that was killed mid-flight and the rule file read
  in full. (Lesson [[three-pillars-conformance-spec]] `[^3]`.)
- **PLACEMENT:** authored DIRECTLY in `design/specs/` (not `proposals/`) — USER-directed = born-
  approved mandate (authority(user) >= manager floor), matching the 3-pillars spec placement.
- **NEXT ACTION:** none — record the impl commit in `implementation-commits:` after the main commit.
- **SUPERSEDED — do NOT carry forward:** the reports/spec-distiller/*.md distillation report is
  scratch evidence only (a summary); it is NOT spec content and was not used verbatim.

## What the USER directed

> "you must create the spec files out of the scenario rules file and the governance rules files. no
> need to be too much structured. just make each rule more concise, dry, greppable and with keywords.
> include in the specs also the specs of the runner agent and the procedures for doing scenarios
> tests, so that the web scenario tester plugin will be able to use this spec file to validate its
> own agents, skills, scripts, etc."

Then, correcting the first (too-summarized) cut:

> "you don't write a spec using summaries. specs are usually more detailed than rules files. you must
> read the whole rule file, one rule at a time."

## What this TRDD did

1. Read `docs/GOVERNANCE-RULES.md` (v4.5.0, 1651 lines) in full, rule by rule, and authored
   `design/specs/governance-spec.md` capturing every R1-R49 rule + sub-rule as a dry greppable clause
   (`` `R<n>.<sub>` `` anchors so a citation resolves to the same clause in the catalog and here),
   plus the 22 invariants (`GOV-INV-NN`), the comm graph + 8 titles + title→plugin map + permission
   matrix as machine-parseable `@spec:*` blocks, and a `GOV-VAL` code-conformance checklist.
2. Read `tests/scenarios/SCENARIOS_TESTS_RULES.md` (Rule 0-14) in full and `.claude/agents/
   scenario-runner.md`, and authored `design/specs/scenario-tests-spec.md` capturing each rule
   atomically (`STS-R<n>.<sub>`), the runner-agent contract (`STS-RUN`, the 1M-model floor / no-MCP /
   write-guard / phases / return contract / implementer separation), the test procedures (`STS-PROC`),
   the scenario-file format (`STS-FILE`), and the `STS-VAL` checklist the web-scenario-tester plugin
   runs against its own agents/skills/scripts/commands.
3. Updated `design/specs/README.md` with a "Current specs" section + the read-whole-rule-file method.
4. Added lesson `[^3]` to the PROJECT memory note (spec-from-summaries is wrong; read the whole rule
   file, one rule at a time; a spec is more detailed than its source).
5. Killed the mid-flight Sonnet distiller (its output was summaries — unusable per the USER correction).

## The rule files STAY where they are

`docs/GOVERNANCE-RULES.md` (canonical, §0-mirrored) and `tests/scenarios/SCENARIOS_TESTS_RULES.md`
(loaded into the runner via the `scenarios-rules` skill) are RULE artefacts and do NOT move — only
the describing SPECs go in `design/specs/`. A SPEC and a RULE FILE are different things (TRDD-P58RCR2C,
`design/specs/README.md`).

## Verification
- `grep` confirms all R1-R49 + all 22 invariants + all machine blocks in governance-spec.md; all 15
  rules R0-R14 with 87 sub-clauses + RUN/PROC/FILE/VAL in scenario-tests-spec.md.
- No governance-password literal in either spec (env-var-name references only).
- Both specs greppable (`grep 'GOV-R41'`, `grep '`STS-R6'`, `grep '@spec:comm-graph'`).

## Approval log
- 2026-07-22T10:19:26+0200 — MANDATE (mandated-by USER; the USER directed authoring both specs and
  the read-whole-rule-file method; floor `manager` for governance-adjacent docs; authority(user) >=
  authority(manager) ⇒ valid, born approved).
