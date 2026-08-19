---
trdd-id: PTFPGSLV
title: trddgrep cannot express an external blocker and its checklist lint ignores the grandfather boundary
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-19T04:32:22+0200
updated: 2026-08-19T05:10:59+0200
implementation-commits: [c242d4ca, d37d73d0]
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

## ⏵ STATE — 2026-08-19 05:04 — IMPLEMENTED (c242d4ca), live via the tsx launcher; awaiting fleet re-runs

Reproduced FIRST on a 6-card fixture: both external shapes mangled to `GH:EMASO`/`AMAMA:TR`
ERROR — but the grandfather boundary itself already worked (fleet symptom half-stale); the
REAL half-2 gap was an unparseable `updated:` being silently skipped, now failing OPEN.
Landed: `classifyBlockerRef`/`localRefList`/`externalRefList` in lib/trdd-graph.ts (scoped
to blocked-by ONLY — dropping a bogus `gh:` from npt would soften childMissing); WARN kinds
GRAPH-EXTERNAL-BLOCKER / GRAPH-CROSS-PROJECT-BLOCKER carrying the RAW spelling;
blockedNotBlocked counts externals; graph, pillar index and trddgrep board all read one
helper; `why`/`roots`/chain annotate external-only blocked cards via COLUMN (the one fact
both feeders carry, keeping the walk-vs-index differential comparable). 12 new tests.

NEUTER RUNS (all via scripts/dev/neuter, restores blob-hash-verified; predictions exact):
filter-off → 3 red · severity-always-error → 2 red · fail-open-reverted → 1 red (BADDATE1)
· kinds-not-emitted → 4 red · gate-ignores-externals → 5 red. By-effect on the deployed
PATH `trddgrep`: fixture shows WARN/WARN/ERROR + fail-open note verbatim.

Side finds, both fixed in-session: 78J4I4QS + S97TNMIJ sat `complete` in the OPEN zone
(archived, ab3eb598) and the live-census filter test re-pinned 265→262 (d37d73d0).

**CLOSED 2026-08-19 05:11 — both fleet re-runs CONFIRMED (box 4):** AMAMA: sanctioned-residual
class 11 → 0 (1 bare hub blocker migrated to `ai-maestro:TRDD-LT5N2JA4` → WARN
GRAPH-CROSS-PROJECT-BLOCKER exactly as specced, their 5dacf05; the other 10 reclassified as
TRUE local TERMINAL-WITHOUT-CHECKLIST findings — legacy cards whose `updated:` was
mechanically bumped past the boundary by their 2026-08-04/05/07 sweeps, correctly refused
grandfathering; their remediation task, not a parser gap). COS: 2 sanctioned ERRORs → the two
WARN kinds with sanctioned spellings restored to `blocked-by:` (their 54503c4), `why` reports
BLOCKED with the external annotation, all 8 KNOWN_UNGATED legacy cards CLEAN under the
boundary, suite 341 green.

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

- [x] `blocked-by: [gh:Emasoft/ai-maestro#145]` lints WARN not ERROR (GRAPH-EXTERNAL-BLOCKER,
      raw spelling; fixture-verified on the deployed launcher), and the graph verbs treat the
      card as blocked: `next` excludes `blocked` columns, `why` says BLOCKED (not READY) on an
      external-only card, roots/chain annotate the leaf.
- [x] `blocked-by: [amama:TRDD-LT5N2JA4]`-style scoped citation lints WARN not ERROR
      (GRAPH-CROSS-PROJECT-BLOCKER); the bare unknown-id ERROR is unchanged (pinned; the
      filter-off neuter reds 3 tests incl. the `#`-bearing-ref truncation line).
- [x] A terminal card with `updated:` < 2026-07-31 and no checklist lints CLEAN; one dated after
      still ERRORs (pre-existing OLDCARD1/NOBOXES1 pair straddles the boundary); NEW: an
      unparseable `updated:` FAILS OPEN (BADDATE1; its neuter reds exactly that test).
- [x] COS re-runs on their corpus: 2 sanctioned ERRORs → WARNs (GRAPH-EXTERNAL-BLOCKER +
      GRAPH-CROSS-PROJECT-BLOCKER, their 54503c4, suite 341 green); AMAMA re-runs: sanctioned
      residual class 11 → 0 (1 migrated to the scoped WARN, 10 reclassified as TRUE
      TERMINAL-WITHOUT-CHECKLIST findings on cards bumped past the boundary — their local
      remediation, not a parser gap). Both reports ledgered in the STATE above.
