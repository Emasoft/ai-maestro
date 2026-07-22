---
trdd-id: CR8JRH74
title: Author the maintained 3-pillars conformance SPEC as the normative arbiter both IND bases and DEP overlays conform to
column: complete
created: 2026-07-22T07:54:21+0200
updated: 2026-07-22T08:02:41+0200
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T07:54:21+0200
relevant-rules: []
eht: [QP07O1BK]
labels: [governance-rules, ind-dep-split, three-pillars-spec, cross-repo-contract, am85]
external-refs: [Emasoft/ai-maestro#85, Emasoft/ai-maestro#83, Emasoft/ai-maestro-janitor#73]
release-via: none
implementation-commits: [ef7117f9]
---

# Author the maintained 3-pillars conformance SPEC as the normative arbiter both IND bases and DEP overlays conform to

Fulfils janitor issue `#85` and the USER directive that opened it: the IND rules the
janitor installs at user scope *"must still be validated against the 3-pillars specs
file from the ai-maestro repo"* — a file that did not exist. Second USER directive
(mid-implementation, 2026-07-22): *"the specs must be stored along with the governance
rules, same dir."*

## Problem

The pillars' invariants — the 17-column kanban vocabulary above all — live duplicated
across **five** artefacts with **no arbiter**: `universal-kanban.md` prose (janitor IND),
`types/task.ts::DEFAULT_STATUSES`, `types/team.ts::DEFAULT_KANBAN_COLUMNS`,
`GOVERNANCE-RULES.md` R25, and the DEP overlays. Two independently-authored halves of one
system (janitor IND + ai-maestro DEP/code) with no shared normative source is precisely
how the split silently drifts — this coordination thread alone produced three instances
of each side being confidently wrong about the other's half.

## Decision (ai-maestro as delegated decider)

ACCEPT #85. ai-maestro hosts a single maintained, versioned 3-pillars conformance SPEC —
the arbiter both the janitor IND rules and the ai-maestro DEP overlays + enforcement code
conform to.

## The one design constraint that made this non-trivial (the caveat)

**The spec MUST be a CONFORMANCE CONTRACT, not a re-narration of rule prose.** A prose
copy is the exact `design/rules-refactor/independent/` mirror ai-maestro just RETIRED
(TRDD-TAFH4U0G) — drift reborn under a new filename, now a THIRD representation that can
disagree with the other two. So the spec states authoritative VALUES + testable
MUST-assertions + the IND/DEP boundary test + a semver version stamp, and explicitly
defers the teaching prose to the rules and the executable logic to the code. It pins the
janitor's five requested items: (1) the 17-column vocabulary + lifecycle shape, (2) the
TRDD frontmatter/id/scope contract, (3) the PRRD tier model, (4) the IND/DEP boundary
test — the item the janitor most needed, previously applied from memory — and (5) the
version stamp.

## Placement (second USER directive) + its edge cases

Per *"same dir as the governance rules"*: the spec lands in `rules/aimaestro/` beside the
DEP overlays — NOT `design/requirements/`. Getting that right required decoupling "file
in `rules/aimaestro/`" from "seeded overlay":

- The seeder (`lib/agent-rules-seed.ts`) and the `dep-rules` invariant discovered files
  by bare `.md`; every file in the dir happened to be an `aimaestro-*` overlay, so
  `.md` == `aimaestro-*.md`. A spec named `aimaestro-*.md` would be SEEDED into every
  agent workdir → injected into every agent's per-turn context (the exact cost the
  2200-byte `aimaestro-agent-rules.md` budget exists to prevent) AND would break the #83
  overlay-filename pin set.
- Fix: name the spec `3-pillars-spec.md` (NO `aimaestro-` prefix) and TIGHTEN the seeder
  discovery `.md` → `aimaestro-*.md`. This aligns the code with its OWN ownership-contract
  comment ("ai-maestro owns the `aimaestro-*.md` NAME") and the `dep-rules` invariant's
  own description ("the shipped **aimaestro-*.md** rules"); it is a **no-op today** (all 5
  current files are `aimaestro-*`). A non-overlay doc now shares the dir harmlessly:
  present with the governance rules, but never seeded, never symlinked into this repo's
  `.claude/rules/`, never counted as an overlay.

Verified the only seed-discovery point is `agent-rules-seed.ts:115` (the `dep-rules`
invariant delegates to it); `workdir-gitignore-seed.ts` already scopes to `aimaestro-*.md`;
`agent-operating-rules.test.ts` / `trdd-corpus-invariants.test.ts` read by exact name, not
glob — so no other consumer is affected.

## Files
- `rules/aimaestro/3-pillars-spec.md` — the spec (NEW).
- `lib/agent-rules-seed.ts` — seed filter `.md` → `aimaestro-*.md` (+ WHY comment).
- `tests/unit/aimaestro-overlay-filename-contract.test.ts` — mirror the tightened
  discovery; add the spec-colocation + spec-not-seeded assertions.
- `tests/unit/three-pillars-spec-conformance.test.ts` — the EHT (TRDD-QP07O1BK).

## The bidirectional loop this closes
- #83 froze the overlay FILENAMES the janitor IND bases cite (ai-maestro CI).
- This spec + the janitor's conformance check (janitor's to build, #85) freeze the
  content CONTRACT — the other direction.
- ai-maestro's own `three-pillars-spec-conformance.test.ts` proves code conforms to spec.

## Verification
- `npx tsc --noEmit` clean.
- `yarn test` green — incl. the retargeted overlay pin test and the new conformance test.
- `grep -c` the spec has a `spec-version:` stamp and exactly 17 columns.

## Approval log
- 2026-07-22T07:54:21+0200 — MANDATE (mandated-by USER; floor `manager` for a governance
  meta-artifact + cross-repo contract; authority(user) >= authority(manager) ⇒ valid,
  born approved). USER directed the spec's existence (#85) and its placement ("same dir").
  Parent of EHT TRDD-QP07O1BK; cannot reach `complete` until that EHT is terminal.
