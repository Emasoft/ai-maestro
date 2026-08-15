---
trdd-id: BL0W6LGY
title: prrdgrep and specgrep have no lint or validate verb — a malformed document has no detection path
column: todo
created: 2026-08-15T16:21:16+0200
updated: 2026-08-15T16:21:16+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
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
blocked-by: [2R34M8FA]
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

- [ ] `prrdgrep lint` + `specgrep lint` exist, share the guard's predicate module
- [ ] Exit 0/1/2 with non-vacuity in the tool
- [ ] Seeded-violation test per predicate + neuter runs
- [ ] SPEC corpus (design/specs/*.md, 4 files) lints clean or its findings are carded
