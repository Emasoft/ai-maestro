---
trdd-id: PTFPGSLV
title: trddgrep cannot express an external blocker and its checklist lint ignores the grandfather boundary
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-19T04:32:22+0200
updated: 2026-08-19T04:32:22+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [trddgrep, three-pillars, fleet-reported, owner-ours]
external-refs: [Emasoft/ai-maestro#145, Emasoft/ai-maestro#76]
---
# trddgrep cannot express an external blocker and its checklist lint ignores the grandfather boundary

## Problem

Reported independently by THREE fleet sessions on 2026-08-19 (COS, AMAMA ×2 asks) — the tool has
two expressiveness gaps that force correct corpora to carry sanctioned false positives:

1. **External blockers.** `blocked-by:` semantically admits only TRDD ids, but a card genuinely
   blocked on a GitHub issue or a cross-project TRDD has no legal spelling. Measured: COS's
   `blocked-by: [ai-maestro#145]` is parsed as an id, truncated/uppercased to `AI-MAEST`, and
   reported `ERROR GRAPH-UNKNOWN-BLOCKER "which does not exist"`. AMAMA's cross-project bare id
   `LT5N2JA4` (owned by this hub) hits the same ERROR because the graph only resolves local ids.
   Removing the entry to silence the tool blinds the board — the blocker is real.
2. **Grandfather boundary.** The TERMINAL-WITHOUT-CHECKLIST rule binds transitions INTO terminal
   columns from 2026-07-31 (aimaestro-trdd-approval D4 §5b), but the lint flags ALL terminal
   cards without a checklist — so legacy corpora (10 cards in AMAMA, 8 in COS's KNOWN_UNGATED)
   report permanent errors on FROZEN cards that must not be edited (IND base step 12). A wall of
   unfixable warnings is how a linter gets routed around.

## Proposed fix (both in `lib/trdd-*` / `scripts/trddgrep.mjs`, shared with trdd-doctor)

1. Accept in `blocked-by:` — and have the GRAPH resolve or skip, never mangle:
   - `<project-id>:TRDD-<id8>` (the canonical cross-project citation, aimaestro-trdd-approval
     overlay) → WARN `cross-project blocker not locally resolvable`, never ERROR;
   - `gh:<owner>/<repo>#<n>` (external issue) → WARN, graph edge skipped;
   - a bare local id → resolved exactly as today (ERROR when it does not exist stays correct).
   The interim fleet ruling (issued to AMAMA + COS, 2026-08-19) stays valid until this lands:
   blocked-by holds LOCAL-corpus ids ONLY — the graph resolves against the local corpus, so a
   REMOTE TRDD id (e.g. a hub id cited from a plugin repo) ERRORs exactly like an issue ref and
   belongs in `external-refs:` + STATE too, with the card parked via review-after or
   human_review. (First issued as "ids-only", which COS correctly refuted by measurement the
   same night — a hub id in their corpus reproduced GRAPH-UNKNOWN-BLOCKER.) This card upgrades
   that workaround into syntax.
2. TERMINAL-WITHOUT-CHECKLIST: suppress for cards whose terminal transition predates 2026-07-31.
   The transition date is not a frontmatter field — derive it honestly: use `updated:` for
   archived/terminal cards (the closing edit bumps it) and state that approximation in the rule's
   own message; a card with an unparseable date FAILS OPEN (flagged), never silently skipped.

## Acceptance

- [ ] `blocked-by: [gh:Emasoft/ai-maestro#145]` lints WARN not ERROR, and the graph verbs
      (`why`, `roots`, `next`) treat the card as blocked without a resolvable local edge.
- [ ] `blocked-by: [amama:TRDD-LT5N2JA4]`-style scoped citation lints WARN not ERROR; the bare
      unknown-id ERROR is unchanged (a neuter re-introducing the truncation reds a test seeded
      with a `#`-bearing ref).
- [ ] A terminal card with `updated:` < 2026-07-31 and no checklist lints CLEAN; one dated after
      still ERRORs; the seeded pair straddles the boundary.
- [ ] COS re-runs on their corpus: their 2 sanctioned ERRORs become WARNs; AMAMA re-runs: 11
      sanctioned residuals drop to 0 errors.
