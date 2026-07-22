---
trdd-id: P58RCR2C
title: Adopt the design-document taxonomy — relocate the 3-pillars SPEC to design/specs/ and establish the SPEC lifecycle folders
column: complete
created: 2026-07-22T09:30:53+0200
updated: 2026-07-22T09:32:51+0200
current-owner: ai-maestro
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T09:30:53+0200
relevant-rules: []
labels: [governance-rules, design-doc-taxonomy, three-pillars-spec, specs-folder, am85]
external-refs: [Emasoft/ai-maestro#85, TRDD-CR8JRH74, TRDD-70B313GT, TRDD-QP07O1BK]
release-via: none
implementation-commits: [8fd7ed19]
---

# Adopt the design-document taxonomy — relocate the 3-pillars SPEC to design/specs/ and establish the SPEC lifecycle folders

USER-established taxonomy (2026-07-22): three project design-document types, each with a folder and
a strict authority order.

```
PRRD  (design/requirements/)  WHAT must be true      — discursive, anything-goes, golden/silver
  ▲ SPEC must comply with PRRD
SPEC  (design/specs/)         HOW it is defined       — formal, machine-parseable, versionable/validatable/diffable/greppable
  ▲ TRDD must comply with SPEC + PRRD (else MANAGER/COS refuse it)
TRDD  (design/tasks/)         the actionable WORK     — kanban card, assignee, checklist
```

A SPEC is the *implementation* of the requirements — as close to code as a doc gets (OpenAPI,
protobuf, JSON-Schema compile straight into code), so it may not be vague. A SPEC lifecycle mirrors
the TRDD one: draft in `design/specs/proposals/` → approved (PRRD-compliance-gated) → moved to
`design/specs/`; superseded revisions go to `design/specs/archived/`.

## What this TRDD did (ai-maestro's adoption)
- Created `design/specs/`, `design/specs/proposals/`, `design/specs/archived/` + a README codifying
  the doc-type definition, the PRRD→SPEC→TRDD authority order, and the approval-gated lifecycle.
- `git mv rules/aimaestro/3-pillars-spec.md → design/specs/3-pillars-spec.md` (the reference SPEC
  that establishes the shape). This RECONCILES the earlier "specs sit with the governance rules"
  directive rather than contradicting it — the governance rules are THEMSELVES specs, so both belong
  in `design/specs/`; the DEP overlays remain in `rules/aimaestro/` only for the seeding mechanism.
- **Reverted the now-obsolete seeder workaround.** CR8JRH74 had tightened
  `lib/agent-rules-seed.ts` (`.md` → `aimaestro-*.md`) + added pin-test colocation assertions
  purely so the spec-in-rules/aimaestro/ would not be seeded into every agent's context. With the
  spec moved to design/specs/ (zero seeder coupling), that workaround is dead code → reverted to the
  original `.md` filter; removed the two colocation assertions. No functional change today (all
  rules/aimaestro/ files are `aimaestro-*`).
- Fixed the spec's own stale self-reference (3P-CHK-02 no longer "pins its colocation"); bumped
  `spec-version` 1.1.0 → 1.1.1.
- Updated the PROJECT memory note path (rules/aimaestro → design/specs) + added a supersession
  lesson; the three FROZEN complete TRDDs (CR8JRH74/QP07O1BK/70B313GT) were left untouched
  (terminal-column rule) — their bodies remain historically accurate and this TRDD records the move.

## Follow-ups (separate, need their own go)
1. **Janitor IND coordination** — the doc-type taxonomy is UNIVERSAL (a 3-pillars concept), so SPEC
   as a first-class doc type + the authority order + the lifecycle is an IND-base delta to propose
   to the ai-maestro-janitor (symmetric with its `trdd-design-tasks.md` / `prrd-design-rules.md`).
   The formal universal taxonomy spec would be the janitor's IND; ai-maestro's README + this
   adoption are the working reference until it lands.
2. **Reclassify `docs/GOVERNANCE-RULES.md` as a SPEC** — it is a formal, R-numbered, semver'd rule
   catalog; it should meet the SPEC acceptance bar and live under the SPEC lifecycle.
3. **Upgrade `tests/scenarios/SCENARIOS_TESTS_RULES.md` to a true SPEC** — the USER noted it is
   spec-shaped but lacks some elements required to qualify (version stamp, clause-ID scheme,
   validatable structure).

## Verification
- `npx tsc --noEmit` clean.
- `yarn test` — the moved spec's conformance test passes at the new path; the overlay pin test
  passes reverted to `.md`; seeder + invariant tests green.
- `find design/specs` shows the spec + README + proposals/ + archived/.

## Approval log
- 2026-07-22T09:30:53+0200 — MANDATE (mandated-by USER; the USER designed the taxonomy and agreed
  to the relocation; floor `manager` for a governance taxonomy change; authority(user) >=
  authority(manager) ⇒ valid, born approved). Follow-ups 1-3 are NOT authorized by this TRDD.
