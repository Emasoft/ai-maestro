---
trdd-id: BL0W6LGY
title: prrdgrep and specgrep have no lint or validate verb — a malformed document has no detection path
column: completed
created: 2026-08-15T16:21:16+0200
updated: 2026-08-15T17:15:20+0200
implementation-commits: [c29661bb]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
parent-trdd: 1ZMEXD9X
priority: 1
severity: high
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [gap-survey, a1, pillar-tooling, lint]
npt: []
eht: []
blocked-by: []
---

# prrdgrep/specgrep lint verbs — post-write detection for the other two pillars

## Problem (A1 survey, hub-verified 2026-08-15)

`prrdgrep`/`specgrep` expose only `edit/show/list` (lib/pillar/cli.ts:198-209).
`yarn pillars:lint` covers ONLY the cross-pillar reference DAG (its own header says so) —
not internal grammar. So for PRRD/SPEC content there is no pre-write validation AND no
post-write lint: a malformed document has NO detection path at all, vs TRDD's
doctor+validate. Report: reports/gap-survey/20260815_161922+0200-A1-pillar-tooling.md
(gaps 4-5).

## Fix shape

Add `lint`/`validate` verbs to the shared `runPillarCli` (both CLIs get them for free),
running the SAME predicates as the 2R34M8FA write-guard (one predicate set, two call
sites — the linter/fixer-drift lesson: a checker and a gate that disagree is the worst
asymmetry). Exit trichotomy 0/1/2 with non-vacuity (0 documents scanned → 2). Blocked-by
2R34M8FA because the predicate module is built there; this card wires it as a verb and
adds the corpus-level sweep (`yarn pillars:lint` grows a `--grammar` pass or a sibling
task).

## Acceptance

- [x] `prrdgrep lint` + `specgrep lint` (alias `validate`) exist — `lintPillarLines`/
      `lintPillarCorpus` in the SAME module as the write gate, running the SAME shared
      finders (declIdReader, prrdNumberLines, specIdLines, statusTokenViolation —
      refactored out of the guard in the same commit, c29661bb)
- [x] Exit 0/1/2 with non-vacuity IN THE TOOL (0 documents scanned → 2; CLI-level test
      drives all three codes; verified live: `prrdgrep lint` with no PRRD.md → exit 2)
- [x] Seeded-violation test per predicate — 13 tests in `tests/unit/pillar-lint.test.ts`
      incl. false-positive controls (digit-free bold bullets, `yarn build` tokens,
      body-prose status:) and a guard↔lint agreement cross-check. Neuters: N1 (predicates
      no-op) → exactly the 7 predicate/exit-1 tests red, 6 controls green; N2 (non-vacuity
      branch removed) → exactly the empty-corpus test red. Both reverted, blobs = HEAD
- [x] SPEC corpus lint result CARDED — first live run: 46 REAL findings (44 declarations
      the canonical grammar under-matches + 2 line-leading-citation conflations), every
      sampled line read first-hand → TRDD-IG1MMYFA (grammar widening). The lint is correct;
      the grammar is the defect — findings stand until IG1MMYFA lands

## Approval log

- 2026-08-15T17:15:20+0200 — COMPLETED by ai-maestro (self-mandate, min-approval-requirement
  none). Implementation c29661bb; the corpus findings are owned by TRDD-IG1MMYFA.
