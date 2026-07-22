---
trdd-id: CJWC3JLU
title: Invert governance authority — the SPEC is the source of truth and GOVERNANCE-RULES.md emanates from it (spec-first)
column: human_review
created: 2026-07-22T17:02:20+0200
updated: 2026-07-22T18:20:00+0200
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
implementation-commits: [60c38453, 032b274f]
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

**REWRITE PHASE (USER, 2026-07-22 — supersedes the inversion NEXT ACTION):** USER caught that the
inversion's feature-parity check was COUNT-based (335/335 ids), NOT content-based — dangerous because
the spec is now authoritative and agents may DELETE any feature absent from it. Directive: rewrite the
WHOLE spec from `docs/GOVERNANCE-RULES.md`, omitting NOTHING (every parameter/detail/schema).
DONE so far: 6 capture agents produced full-fidelity fragments A/B1/B2/C/D/E; an assembler produced
`NEW-SPEC.md` (1998 lines / 170KB — vs old 78KB, faithful not summarized) at
`/private/tmp/claude-501/-Users-emanuelesabetta-ai-maestro/43e66c93-aa93-421a-87d9-64ae53310766/scratchpad/spec-fragments/NEW-SPEC.md`.
Structure verified: 49 GOV-R + 14 sections in order + GOV-OVERVIEW; 5 authority fixes applied
(GOV-META-01/02, GOV-VER-01, GOV-MNT-01/02 — the inversion missed these); dedicated tables took the
fuller source (inv=22, perm=E full 12-row); GOV-GREP `@spec:` anchors resolve; R39.2=v4.4.0; GOV-INV
held at 22 (R41.5/R42.1 NOT promoted).

**✅ REWRITE + CONTENT-VERIFY GATE DONE (2026-07-22, commit `032b274f`).** All 6 chunks content-verified
by ITEMIZED `source⊆assembled` miss-lists (counts forbidden as the deliverable): A/B1/B2/C/D by sub-agent,
E (R41-R49 + the 12×6 permission matrix — highest-risk table) verified FIRST-PARTY in-context after the
AgentLens burn-gate blocked its agent. **Result: 0 material misses across all 6.** 2 non-material B2
phrase trims restored for max fidelity (Codex `marketplace add` sentence in R20.per-client-manifest-schema;
"AID identity rules" cross-ref in R20.15). 5 authority-direction fixes verified INVERTED (GOV-META-01/02
spec-authoritative + update-spec-first; GOV-VER-01 spec-version-leads; GOV-MNT-01/02 this-file-leads).
NEW-SPEC (1998 lines, 49 GOV-R, 14 sections, 894→1998 / 78KB→170KB) placed at
`design/specs/governance-spec.md` + committed `032b274f`. Conformance test
`tests/unit/governance-spec-conformance.test.ts` = **14/14 PASS** (the @spec:comm-graph / title-plugin-map /
titles blocks extract + match live code; the duplicate @spec:titles in GOV-TERM was de-collided to
@spec:three-layer-model so the marker stays unique). Verifier reports: `scratchpad/spec-fragments/verify-{A,B1,B2,C,D,E}.md`.

**✅ ALL WORK DONE — pushed `fork governance-rules` (`5b0b12a0..a7df9006`): spec `032b274f` + TRDD record
`a7df9006`. The last EHT (correct MANAGER #30) was already satisfied during the inversion (`5b0b12a0`) —
VERIFIED 2026-07-22 by reading the live #30 comment: it inverts the authority (spec = SOURCE, catalog =
primary emanation, re-point your read to `governance-spec.md`). The MANAGER re-reading the spec now picks up
the fuller 2.1.0 rewrite automatically; no redundant follow-up needed. Column → `human_review` for USER
inspection of the new source-of-truth spec.**

**EHT — ✅ DONE (verified 2026-07-22):** the #30 correction is live on
ai-maestro-assistant-manager-agent#30 (posted with the inversion, `5b0b12a0`) — it tells the MANAGER the
authority is INVERTED: the spec is the source, the catalog emanates, re-point your read to the spec as
canonical. No stale authority claim remains in the fleet.

**SUPERSEDED — do NOT carry forward:** the "Mirror-sync: governance-spec.md" discipline (prose→spec)
and any statement that GOVERNANCE-RULES.md is the canonical source. Both are reversed by this TRDD.

## Verify
`grep -n "source of truth" docs/GOVERNANCE-RULES.md design/specs/governance-spec.md` → the spec is
named the source in both; `git log --oneline -1` cites TRDD-CJWC3JLU; #30 carries the correction.
