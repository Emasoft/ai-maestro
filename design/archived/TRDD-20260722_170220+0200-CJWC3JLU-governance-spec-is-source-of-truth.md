---
trdd-id: CJWC3JLU
title: Invert governance authority — the SPEC is the source of truth and GOVERNANCE-RULES.md emanates from it (spec-first)
column: completed
created: 2026-07-22T17:02:20+0200
updated: 2026-08-22T18:16:25+0200
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

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verify` line and the numbered EDITS its STATE
specifies, re-run live. One criterion is transcribed by INTENT rather than literally — see the note
under it. The card sits in `human_review`: the work is done, what is outstanding is the USER's read.

- [x] **the spec is named the source in BOTH files** — `design/specs/governance-spec.md:9`
      (frontmatter `authority:`) and `:27` in prose; `docs/GOVERNANCE-RULES.md:8` records the
      inversion in its own changelog and calls itself the PRIMARY EMANATION
- [x] **EDIT 1 — the spec's frontmatter is inverted**: `derived-from:` is GONE (verified absent, not
      merely unread), `spec-version` took the MAJOR bump for the role change
- [x] **EDIT 2 — the catalog's §0 declaration is flipped** and carries the `4.8.0` changelog entry
      naming the reversal, including the retirement of the old "Mirror-sync" direction
- [x] the implementing commits cite `TRDD-CJWC3JLU` — `60c38453` (the inversion), `032b274f` (the
      full-fidelity rewrite), plus `5b0b12a0` / `a7df9006` / `b0f9445e`.
      **Transcribed by intent.** The literal criterion — *"`git log --oneline -1` cites
      TRDD-CJWC3JLU"* — was an INSTANTANEOUS observation, true only until the next commit landed.
      Taken literally it is a box that must fail forever after; what it meant is that the work is
      traceable to the card, and that is what is checked
- [x] **`ai-maestro-assistant-manager-agent#30` carries the correction** — read live today, not
      inferred from the card: the comment states the direction is INVERTED, names the spec as SOURCE
      and the catalog as PRIMARY EMANATION, and tells the MANAGER to re-point its read. The issue is
      still OPEN, which is correct — it is the SPEC-layer thread, not a task this card owns
- [x] the rewrite's content-verify gate passed — 6 chunks by itemized `source ⊆ assembled` miss-lists
      (counts explicitly forbidden as the deliverable, because the USER caught the inversion's
      parity check being COUNT-based and therefore blind to content loss), **0 material misses**
- [x] `tests/unit/governance-spec-conformance.test.ts` — **14/14 green, re-run 2026-08-02**;
      re-run again 2026-08-22 live: `exit=0`, `Test Files 1 passed (1)`, `Tests 14 passed (14)`
- [x] **inspection of the new source-of-truth spec** — **PERFORMED 2026-08-22 under the standing
      owner grant** (*"i authorized you to decide on my behalf, so you must do the human review and
      also decide all the rest. just decide in base of verified facts and tests, never assume
      anything."*). This box was written as *"not this card's to check off"*; the grant moves the
      review verdict, so it is checked off here rather than parked. What was actually inspected is
      recorded in the verdict block below — not the card's own prose, but the two artifacts and one
      neuter run

## ⏱ VERIFIED 2026-08-02 — the inversion did not merely land, it has been USED

The strongest evidence is not that the two files still say the right thing; it is that the artifact
this card made authoritative **has been edited three more times as the authority, and the catalog
followed each time**:

| | at the card (2026-07-22) | today |
|---|---|---|
| `spec-version` | 2.0.0 → 2.1.0 | **2.3.0** |
| catalog `version` | 4.8.0 | **5.2.0** |
| `GOV-R` sections | 49 | **51** |
| spec length | 1998 lines | **2052** |

Two rules have been authored since, and they were authored in the SPEC — which is the whole point of
the inversion and the one thing a static grep of the authority sentence could not tell you. A card
that only re-checked its own edits would have reported "unchanged, still correct" and missed that
the model is live.

## ✅ REVIEW VERDICT 2026-08-22 — COMPLETE (reviewed under the standing owner grant)

Three checks, all first-hand today. Nothing below is inherited from the card's own prose.

**1. The authority declaration is intact in BOTH files, and neither has drifted back.**

```
design/specs/governance-spec.md:3   spec-version: 2.6.0
design/specs/governance-spec.md:6   updated: 2026-08-20T16:16:40+0200
design/specs/governance-spec.md:9   authority: "SOURCE OF TRUTH — this SPEC is edited FIRST when a
                                    governance rule changes; docs/GOVERNANCE-RULES.md and the
                                    code/personas/DEP-overlays are its IMPLEMENTATIONS, authored
                                    AFTER it … This spec was previously derived FROM the catalog;
                                    that direction is reversed for good."
grep -c '^derived-from:' design/specs/governance-spec.md   → 0   (absent, as EDIT 1 requires)
docs/GOVERNANCE-RULES.md:2          version: "5.5.0"
docs/GOVERNANCE-RULES.md:14         "4.8.0: AUTHORITY INVERSION … the SPEC is now the SOURCE OF
                                    TRUTH; this catalog is its PRIMARY EMANATION."
```

**2. The model is not merely declared, it is being OBEYED — measured on the two most recent rule
changes, both dated 2026-08-20, two days ago.** The catalog's own changelog rows state the order of
authoring, unprompted:

> `docs/GOVERNANCE-RULES.md:7` — *"NEW SUB-RULE R42.9 … **Authored in
> `design/specs/governance-spec.md` FIRST** (spec-version 2.4.3 → 2.5.0) per the authority
> inversion; **this catalog row is its emanation**."*
>
> `docs/GOVERNANCE-RULES.md:6` — *"R42.9 CORRECTED … (**spec led**: governance-spec 2.5.0 → 2.6.0;
> **this row is the emanation**)."*

This is the criterion the open box actually needed answered, and it is the one a static read of the
authority sentence cannot answer: a source of truth that nobody edits first is decoration. Two
independent rule events, one an addition and one a same-day correction, both went spec-first.

Growth since the 2026-08-02 check: `spec-version` 2.3.0 → **2.6.0** · catalog 5.2.0 → **5.5.0** ·
spec length 2052 → **2135** lines · 57 `GOV-R` headings over 50 distinct rule ids.

**3. The spec is load-bearing against the CODE, proven by neuter — not by reading it.** The
conformance suite is the only mechanism that can make a spec/code divergence fail, so its
non-vacuity is what the whole inversion rests on. Flipping ONE cell of the spec's `@spec:comm-graph`
matrix (`MANAGER → ORCHESTRATOR`, `.` → `Y`, i.e. the spec now claims an edge the code denies):

```
 * NEUTER RUN (2026-08-22 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/^MANAGER              Y     Y      Y     \./MANAGER              Y     Y      Y     Y/
 *   → 1 red / 13 green:
 *       row MANAGER matches getEdgeType() for every recipient
```

1 ins / 1 del, exactly the aimed line. So the spec's matrix is genuinely compared against
`lib/communication-graph.ts::getEdgeType()`; a spec that drifted from the code would redden CI.

**VERDICT: COMPLETE.** All eight criteria hold. The engineering landed in July and has been
re-verified twice since; what remained was the review, and the review is done. No follow-up card:
nothing was descoped and nothing was found wanting.

## Approval log

- 2026-08-22T18:20:00+0200 — REVIEWED and CLOSED `human_review → complete` under the standing owner
  grant (*"i authorized you to decide on my behalf, so you must do the human review"*). Evidence:
  the authority declaration re-read live in both files (spec 2.6.0 / catalog 5.5.0, `derived-from:`
  absent); the two most recent rule changes (2026-08-20) each state SPEC-FIRST authoring in the
  catalog's own changelog; `governance-spec-conformance` 14/14 green and NON-VACUOUS by neuter
  (1 red / 13 green on a single flipped comm-graph cell). No follow-up card.
- 2026-08-22T16:16:13.275Z — column → complete. Reviewed under the standing owner grant; authority verified live in both files, spec-first authoring evidenced by the 2026-08-20 rule changes, conformance suite 14/14 and non-vacuous by neuter.
- 2026-08-22T16:16:25.886Z — COMPLETED by user. archived → completed.
