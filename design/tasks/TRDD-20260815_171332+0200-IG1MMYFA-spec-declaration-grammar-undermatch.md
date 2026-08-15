---
trdd-id: IG1MMYFA
title: SPEC declaration grammar under-matches the live corpus — 44 clauses invisible to the store
column: todo
created: 2026-08-15T17:13:32+0200
updated: 2026-08-15T17:13:32+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
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
labels: [gap-survey, pillar-tooling, spec-grammar, found-by-lint]
npt: []
eht: []
blocked-by: []
---

# SPEC declaration grammar under-matches the live corpus

## Problem (found by the FIRST run of `specgrep lint` — TRDD-BL0W6LGY, 2026-08-15)

`SPEC_DECLARATION_RE` in `lib/pillar/kinds.ts` is
`/^`([A-Z0-9]{2,4}-[A-Z]{2,8}-\d{2})`/` — measured on ONE file (3-pillars-spec.md, 38
clauses) and wrong for four shapes the live corpus uses, every one verified by reading the
flagged line:

| shape | example | why it fails |
|---|---|---|
| two segments | `TERM-01`, `COMM-01` (governance-spec) | RE requires three |
| >8-char middle segment | `RP-ASSISTANT-01` | `[A-Z]{2,8}` caps at 8 |
| four segments | `RP-SKILL-MENU-01` | RE has no repeat |
| dotted rule tail | `STS-R0.1` … `STS-R14.1` (scenario-tests-spec) | tail is not `\d{2}` |

Consequence: **~44 real clauses yield NO record** — invisible to `specgrep show/list`, the
SQLite pillar index, and the cross-pillar DAG lint's declaration set. Additionally, a
LINE-LEADING CITATION (`` `AIO-RULE-01` is the only path. `` at all-in-one-spec.md:328,
`` `GOV-INV-16` core-plugin-currency, … `` at governance-spec.md:1387) matches the
declaration RE, so the store double-counts those ids (the exact
declaration-vs-citation conflation the kinds.ts header warns about).

Evidence: `specgrep lint` → 46 findings across 6 documents (44 grammar under-match + 2
citation conflation). The lint is CORRECT given the canonical grammar — do not silence it;
fix the grammar.

## Fix shape

1. Re-measure the FULL corpus declaration inventory (every line-leading backtick token per
   file) and derive the widened grammar from the measurement, not from memory.
2. Widen `SPEC_DECLARATION_RE` (and `citationRe` CONSISTENTLY — the DAG lint resolves
   citations against declarations, so they must widen together; re-run
   `yarn pillars:lint` and diff its findings before/after).
3. Separate declaration from line-leading citation (design decision on the card: e.g.
   first-occurrence-wins per document, or require the `**name**`/definition shape — measure
   which discriminator matches all 44 real declarations and neither citation).
4. Update every census-pinned test that READS the clause count (grep for the 38-clause
   census + conformance families) — re-derive counts with an independent grep, never by
   copying the failure output.
5. `specgrep lint` on the live corpus exits 0, or every residual finding is individually
   justified on this card.

## Acceptance

- [ ] Grammar widened from a recorded corpus measurement; declaration-vs-citation
      discriminator chosen and documented in kinds.ts
- [ ] `specgrep show TERM-01` / `STS-R0.1` / `RP-ASSISTANT-01` resolve
- [ ] Census/conformance tests updated with independently re-derived counts
- [ ] `yarn pillars:lint` before/after diff reviewed; `specgrep lint` clean or justified
