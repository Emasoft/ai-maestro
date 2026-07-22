---
trdd-id: 70B313GT
title: Redesign the 3-pillars SPEC as a greppable reference — stable 3P clause-ID anchors + a 3P-GREP cheat-sheet
column: complete
created: 2026-07-22T08:09:39+0200
updated: 2026-07-22T08:10:16+0200
current-owner: ai-maestro
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-22T08:09:39+0200
relevant-rules: []
labels: [governance-rules, three-pillars-spec, greppable, am85]
external-refs: [Emasoft/ai-maestro#85, TRDD-CR8JRH74]
release-via: none
implementation-commits: [9278bbc6]
---

# Redesign the 3-pillars SPEC as a greppable reference — stable 3P clause-ID anchors + a 3P-GREP cheat-sheet

USER directive (2026-07-22, immediately after CR8JRH74 landed the spec): *"specs are a
reference document, so they must above all be easily greppable, with lines/paragraphs
markers at the beginning that act as keywords/key-phrases for the line/paragraph content."*

CR8JRH74 is `complete` (frozen), so this is a standalone follow-up, not an edit of it.

## Change (format only — no normative content changed)
- Every normative clause now starts with a stable `` `3P-<FAMILY>-NN` `` anchor + a bold
  key-phrase (families: META, VER, KAN, TRDD, PRRD, BND, CHK, MNT). Grep a family
  (`grep 3P-KAN`) or a single clause (`grep 3P-KAN-01`).
- Added a `3P-GREP` cheat-sheet at the top (self-documenting: "to find X, grep Y").
- Clause `3P-VER-03` makes the ids STABLE / never-reused / append-only, so a conformance
  check may CITE a clause by id (e.g. the janitor's #85 check).
- Clause `3P-MNT-03` makes the greppability convention self-perpetuating (a new clause takes
  the next free NN; 3P-GREP must list every family).
- `spec-version` 1.0.0 → **1.1.0** (MINOR per 3P-VER-01: the clause-id citation scheme is a
  non-breaking addition; the 17-column contract and every MUST are unchanged).

## Bug autopsy (caught by the conformance test — the platelet earning its keep)
The 3P-GREP cheat-sheet cites the literal token `@spec:kanban-columns` as a grep example.
The conformance extractor keyed on that BARE token, so it matched the cheat-sheet mention
first and extracted the wrong fence (35 lines, not 17) → 2 red assertions. Fixed by
anchoring the extractor on the actual HTML-comment marker `<!-- @spec:kanban-columns`
(occurs exactly once), with a comment at the fix site explaining why the bare token is
ambiguous. Lesson: a marker a doc also references casually must be distinctive enough that
the reference cannot be mistaken for the marker.

## Files
- `rules/aimaestro/3-pillars-spec.md` — full greppable rewrite (content-preserving), v1.1.0.
- `tests/unit/three-pillars-spec-conformance.test.ts` — extractor anchored on the HTML
  marker; new assertion pinning the 3P-GREP cheat-sheet + a clause anchor per family.

## Verification
- `yarn test tests/unit/three-pillars-spec-conformance.test.ts` — 4/4 green (incl. the new
  greppability assertion + the still-passing 17-column code==spec check).
- `grep -c 3P-KAN rules/aimaestro/3-pillars-spec.md` → non-zero; `grep 3P-BND-01` resolves
  one clause.

## Approval log
- 2026-07-22T08:09:39+0200 — SELF-MANDATE/USER-directed (Tier-0: a format revision of
  ai-maestro's own governance doc, no normative MUST changed → floor `none`; USER directed
  the greppability redesign). Follows CR8JRH74; no version-breaking change.
