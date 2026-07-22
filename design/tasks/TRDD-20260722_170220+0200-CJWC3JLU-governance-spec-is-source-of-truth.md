---
trdd-id: CJWC3JLU
title: Invert governance authority — the SPEC is the source of truth and GOVERNANCE-RULES.md emanates from it (spec-first)
column: dev
created: 2026-07-22T17:02:20+0200
updated: 2026-07-22T17:20:00+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T17:02:20+0200
relevant-rules: [22]
eht: []
npt: []
implementation-commits: [60c38453]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-22

**USER mandate (verbatim intent, 2026-07-22):** *"just update the governance rules specs.. they
are the ones supposed to be updated first.. the verbose rule file should be an emanation, not the
other way around"* → *"revert that for good, since specs are supposed to come before the
implementation! not the other way around!"*

**The inversion.** Until now `docs/GOVERNANCE-RULES.md` was the CANONICAL source (§0 line 48) and
`design/specs/governance-spec.md` was a mirror synced FROM it (every v4.5→v4.7.1 changelog entry
says "Mirror-sync: design/specs/governance-spec.md" — prose edited first, spec followed). The USER
rules this permanently backwards: **the SPEC is the source of truth, edited FIRST; the prose catalog
AND the code/personas/DEP-overlays are its implementations, authored AFTER it.** Specs come before
the implementation.

**Safe to promote the spec to source:** verified its content is already current through v4.7.1 —
R39.10 present, zero residual 'MAESTRO agent' (v4.7.1 reversion applied), R49 + R39.8/R39.9 all in;
`spec max R = catalog max R = 49`. So this is an AUTHORITY flip, not a content backfill.

**The model (going forward):**
```
PRRD (design/requirements/)      WHAT must be true
  ▲ complies-with
SPEC (design/specs/governance-spec.md)   THE SOURCE OF TRUTH — edited FIRST      ← authority lives here
  │ emanates to (all AFTER the spec):
  ├─ docs/GOVERNANCE-RULES.md      the human catalog: rule content (from the spec) + teaching/rationale
  ├─ lib/communication-graph.ts, services/element-management-service.ts, …   the code enforcement
  ├─ rules/aimaestro/aimaestro-*.md   the DEP operating overlays seeded to agents
  └─ the 8 role-plugin personas    the persona-embedded subsets
```
On any disagreement the SPEC governs; the catalog keeps its rationale + changelog (which the spec
lacks) but takes its rule CONTENT from the spec.

**EDITS (surgical — both files, or they contradict):**
1. `design/specs/governance-spec.md` — frontmatter: drop `derived-from:` (spec is no longer derived
   FROM the prose), `spec-version: 1.0.0 → 2.0.0` (MAJOR: the spec's ROLE changed from capture to
   source), bump `updated:`, fix the `implementations:` GOVERNANCE-RULES.md line ("the source" → "the
   primary emanation"); authority prose: flip the final sentence ("GOVERNANCE-RULES.md is
   authoritative for MEANING" → "THIS SPEC is authoritative; the catalog + code are implementations")
   and fix the stale "version: 4.5.0" mention.
2. `docs/GOVERNANCE-RULES.md` — §0 line 48 + §0.1 table: flip the canonical declaration (spec is
   canonical/edit-first; this catalog is the primary emanation); `version: 4.7.1 → 4.8.0` + a changelog
   entry recording the inversion (MINOR — structural, no rule-behavior change).

**NEXT ACTION:** apply the 2-file edit, then the EHT below, then commit (subject cites TRDD-CJWC3JLU)
+ push to `fork` (Emasoft/ai-maestro governance-rules) so consumers see it.

**EHT (do NOT skip — leaves a stale authority claim in the fleet):** I posted
ai-maestro-assistant-manager-agent#30 telling the MANAGER "GOVERNANCE-RULES.md is authoritative for
meaning; spec = shape." That is now INVERTED. Post a correction comment on #30: the spec is the
source; the catalog emanates; re-point your read to the spec as canonical.

**SUPERSEDED — do NOT carry forward:** the "Mirror-sync: governance-spec.md" discipline (prose→spec)
and any statement that GOVERNANCE-RULES.md is the canonical source. Both are reversed by this TRDD.

## Verify
`grep -n "source of truth" docs/GOVERNANCE-RULES.md design/specs/governance-spec.md` → the spec is
named the source in both; `git log --oneline -1` cites TRDD-CJWC3JLU; #30 carries the correction.
