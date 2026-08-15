---
trdd-id: 2R34M8FA
title: PRRD and SPEC writes have no schema gate — build the pillar-edit-guard
column: completed
created: 2026-08-15T16:21:16+0200
updated: 2026-08-15T17:07:15+0200
implementation-commits: [b3a4ec2b]
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

- [x] Guard exists, wired pre-write in the shared pillar edit path (both CLIs) —
      `lib/pillar/edit-guard.ts::pillarPreWriteCheck`, run as `replaceAtLines`' new
      `preWriteCheck` hook INSIDE the document lock (stronger than the TRDD precedent's
      outside-the-funnel placement: no read-outside-the-lock TOCTOU); CLI refusal prints
      `BLOCKED` (exit 2), distinct from `STALE` by design (b3a4ec2b)
- [x] Each rule fires on a seeded violation; positive control — 18 tests in
      `tests/unit/pillar-edit-guard.test.ts`: 10 seeded refusals (each byte-identical after
      refusal), 3 PRRD + 3 SPEC positive controls/allows, TRDD no-op scope, CLI wiring
- [x] Recorded neuter runs — N1 (whole guard no-op): exactly the 10 refusal tests red, 8
      controls green (each refusal fixture seeds ONE illegal thing, so the split attributes
      every branch); N2 (cli.ts wiring removed): exactly the wiring test red. Both reverted,
      blob hashes equal HEAD's
- [x] tsc 0 errors; full suite: 413 files — 407 green + 6 failed on the first run, resolved
      to ZERO regressions: 1 was the R50 store-primitive ratchet correctly flagging
      LMAZO2ET's compensation `saveAgents` (pinned as new category (c) R51-COMPENSATION with
      WHY, count 37→38 — commit alongside this closure); the other 5 (change-title-window,
      aimaestro-settings-cli, fleet-liveness-watchdog, groups-cli, statusline-cli) are the
      KNOWN load-timeout flakes — re-run in isolation same session: 73/73 green

## Verification record (2026-08-15)

- One grammar source: is-a-declaration answered by the kind's own `declarationRe`
  (kinds.ts) — no second regex to drift
- Deliberate-removal shape (rewrite to non-declaration prose) stays ALLOWED; the near-miss
  (still bullet-bold / still backtick-token, no longer parses) is refused — the mechanical
  line between "typo'd the id" and "meant to remove"
- status: legality keys on the VALUE (pipeline column values, bare-token grammar), never on
  the field NAME (the STATUS-HOLDS-COLUMN-VALUE lesson)

## Approval log

- 2026-08-15T17:03:28+0200 — work landed (self-mandate, min-approval-requirement none);
  full-suite verdict appended before the card goes terminal.
- 2026-08-15T17:07:15+0200 — COMPLETED by ai-maestro (self-mandate). All boxes checked; the
  full-suite pass resolved (R50 pin + 5 known isolation flakes re-proven green).
