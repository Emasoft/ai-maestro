---
trdd-id: 2R34M8FA
title: PRRD and SPEC writes have no schema gate — build the pillar-edit-guard
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
derived-kind: eht
parent-trdd: 1ZMEXD9X
priority: 1
severity: high
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [gap-survey, a1, pillar-tooling, write-gate]
npt: []
eht: []
blocked-by: []
---

# PRRD/SPEC writes have no schema gate — build the pillar-edit-guard

## Problem (A1 survey, hub-verified 2026-08-15)

TRDD has a real pre-write schema gate (`lib/trdd-edit-guard.ts::validateTrddFieldEdits`,
called from `trdd-store.ts::editTrdd` BEFORE bytes land — it replaced the 158-card
column-corruption incident). PRRD and SPEC have NOTHING equivalent: `lib/pillar/edit.ts`
implements only the staleness/lock primitive (`replaceAtLines`, `StaleDocumentError`), and
`grep -n "validate" lib/pillar/cli.ts` returns 0. A `prrdgrep edit`/`specgrep edit` that
writes a malformed rule id, a duplicate id across tiers, or an illegal tier flip lands
silently. Report: reports/gap-survey/20260815_161922+0200-A1-pillar-tooling.md (gap 3).

## Fix shape

A `lib/pillar/edit-guard.ts` mirroring the TRDD guard's placement (called from the shared
`runPillarCli` edit path BEFORE `replaceAtLines`), validating per kind:
- PRRD: rule-id grammar `[GS]<n>.<v>`, number uniqueness ACROSS both tiers, version
  forward-only, tier letter legality (per the IND base prrd-design-rules).
- SPEC: clause-id grammar (`3P-XXX-NN` family), `status:` field legality, id uniqueness.
Refuse with a named reason (exit 2 at the CLI, blocked-edit class). Seeded-violation tests
per shape + a neuter run each (the lessons-verification discipline).

## Acceptance

- [ ] Guard exists, wired pre-write in the shared pillar edit path (both CLIs)
- [ ] Each rule fires on a seeded violation; positive control (legal edit passes)
- [ ] Recorded neuter run per guard branch
- [ ] tsc + full suite green
