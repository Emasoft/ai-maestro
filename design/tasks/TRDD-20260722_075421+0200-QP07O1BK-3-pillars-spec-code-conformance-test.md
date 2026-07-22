---
trdd-id: QP07O1BK
title: ai-maestro code-side conformance test asserting types-task.ts DEFAULT_STATUSES matches the 3-pillars SPEC column vocabulary
column: testing
created: 2026-07-22T07:54:21+0200
updated: 2026-07-22T07:54:21+0200
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
parent-trdd: CR8JRH74
approved: true
approval-judge: user
approval-datetime: 2026-07-22T07:54:21+0200
relevant-rules: []
npt: []
eht: []
labels: [governance-rules, three-pillars-spec, conformance-test, am85, derived]
external-refs: [Emasoft/ai-maestro#85]
release-via: none
implementation-commits: []
---

# ai-maestro code-side conformance test asserting types-task.ts DEFAULT_STATUSES matches the 3-pillars SPEC column vocabulary

The platelet for TRDD-CR8JRH74. A spec with no automated conformance check is just prose
that can drift — exactly what the janitor warned against in #85. This is the hole the
parent opens (a new arbiter that nothing enforces) and the EHT that closes it on
ai-maestro's own side (the code half).

## What it does
`tests/unit/three-pillars-spec-conformance.test.ts` reads the authoritative 17-column
block out of `rules/aimaestro/3-pillars-spec.md` (the `@spec:kanban-columns` marker +
fenced block) and asserts `types/task.ts::DEFAULT_STATUSES` deep-equals it (order +
spelling). It reads the block from the spec rather than hard-copying it, so the test
cannot itself become a sixth drifting copy. Also asserts the spec pins exactly 17 unique
columns and carries a semver `spec-version:` stamp.

## Why the code side is ai-maestro's half
The 17-column vocabulary is duplicated in `types/task.ts` (and `types/team.ts`), which is
ai-maestro's code. Enforcing code == spec is squarely this repo's responsibility; the
janitor owns the symmetric check that its shipped IND rules conform (its side of #85).

## Verification
- `yarn test tests/unit/three-pillars-spec-conformance.test.ts` green (3 assertions).
- Negative check: transiently reorder one column in the spec's fenced block → the
  deep-equal fails; revert → green.

## Approval log
- 2026-07-22T07:54:21+0200 — SELF-MANDATE (Tier-0: a test in ai-maestro's own repo, fully
  in-scope; floor `none`). Derived EHT of CR8JRH74 (depth-1, no children of its own).
