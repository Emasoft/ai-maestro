---
trdd-id: MUYRIKN3
title: The 3-pillars spec bump is consumed by the janitor and must reach it
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T00:48:24+0200
implementation-commits: [89810d4b, 728ff37c]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [Emasoft/ai-maestro#85, Emasoft/ai-maestro-janitor#118]
---

# The 3-pillars spec bump is consumed by the janitor and must reach it

## The hole this handles

The parent adds two clause families to `design/specs/3-pillars-spec.md` — `3P-IDX` (index safety)
and `3P-DAG` (the reference DAG) — which is a MINOR bump under `3P-VER-01`: **1.1.1 → 1.2.0**.

That file is not ours alone. Two of its own clauses make the bump other people's business:

- **`3P-CHK-03`** obliges the **janitor** to build a check that its shipped IND bases satisfy this
  spec *at the `spec-version` they declare*.
- **`3P-VER-02`** makes a declared version that differs from this file's `spec-version` a
  **DETECTABLE conformance failure** — that detectability is the entire point of the stamp.

So bumping the number silently either breaks their check or, worse, leaves it quietly passing
against a version that no longer exists.

## Also in-repo

`tests/unit/three-pillars-spec-conformance.test.ts` (4 tests) asserts the version stamp and the
greppability of the clause anchors. New clause ids must take the next free `NN` in their family and
are **append-only, never reused** (`3P-VER-03`).

## LANDED 2026-07-30 — both families, one 1.2.0, one notification

Sequenced in two commits within the hour, deliberately:

1. **`89810d4b`** — `3P-DAG` (3 clauses) + the stamp at **1.2.0**, via NPT `LXLK7XGX`.
2. **`728ff37c`** — `3P-IDX` (14 clauses). This was the REAL gap: Phase 5's index shipped
   (`freshness.ts`, `index-db.ts`, `index-build.ts`, `index-open.ts`, the memgrep contract, the
   edges table) and had **never been spec'd**, so box 2 — "the cheat-sheet lists IDX *and* DAG" —
   was genuinely unmet rather than lagging paperwork. Written from the CODE, not from the plan's
   prose, because this flock's plan has already been wrong twice.

**Why the notification was HELD between those two commits, and why that was safe.** A correction to
a fact this flock had been carrying: `governance-rules` is NOT remote-less — its upstream is
`fork/governance-rules`, and local was **65 commits ahead** (68 by the time the notice went out).
So `spec-version: 1.2.0` existed on no remote, no consumer could read it, and `3P-VER-02`'s
detectable-mismatch could not fire. Announcing after `3P-DAG` alone would have meant two bumps and
two messages for one release; holding one commit cost nothing and bought a coherent 1.2.0.

**The stated risk did not materialize but the rule stands:** had `3P-IDX` stalled, box 4 had to go
out ANYWAY before the first push. The harm begins at PUSH, not at bump.

**Venue (box 4).** Posted as a comment on **Emasoft/ai-maestro#85**, not as a new janitor issue —
because #85 IS the janitor's own still-open request ("a maintained 3-pillars SPEC that the IND bases
can be validated against — none exists today"). Answering the asker on their own thread beats
opening a second thread on their tracker. Self-identified per PRRD G1.1; `_Agent: ai-maestro_`
trailer. The comment is SELF-CONTAINED (both families' assertions tabulated) precisely because the
branch is unpushed and they cannot fetch the file yet — and it says so plainly rather than
announcing a version nobody can read.
→ https://github.com/Emasoft/ai-maestro/issues/85#issuecomment-5124165382

Two of our own corrections were offered back, since they are cheap for them to inherit: `3P-IDX-05`
carries **their** janitor#123 defect (behind-vs-damaged, stamp as sole discriminator) *plus* the
per-COLUMN granularity our first guard for it got wrong — it was per-TABLE, which cannot express a
column-granular skew, i.e. #123's bug one level down. And `3P-IDX-14` carries the retired FTS parity
check: a parity check over an always-empty table passes by construction, costing the scan and
returning reassurance it had not earned.

## Acceptance

- [x] `spec-version: 1.2.0`, and every new clause carries a stable `3P-<FAMILY>-NN` anchor plus a
      bold key-phrase at line start (`3P-MNT-03`) — **DONE** (`89810d4b`); the anchors are pinned by
      the conformance test's family array, proven by a neuter run on `3P-DAG-01`
- [x] `3P-GREP`'s family list includes `IDX` and `DAG` — the cheat-sheet must list every family
      — **DONE**: both in the family list and in the legend (`DAG=reference-dag`,
      `IDX=index-safety`, wrapped to a third legend line). Guarded by the conformance test's family
      array, and NEUTERED: renaming `3P-IDX-01` → `3P-QQQ-01` fails exactly the named greppable test
      (1 failed | 23 passed). That neuter also showed the census test correctly does NOT fire on a
      rename — `3P-QQQ-01` is still a valid declaration, so the count is unchanged. **Two distinct
      guards: the array pins family NAMES, the census pins the COUNT; neither substitutes for the
      other**
- [x] `tests/unit/three-pillars-spec-conformance.test.ts` updated and green — **DONE**: `'DAG'` added
      to the family array (4/4 green). The same change surfaced a SECOND consumer the card never
      named — `tests/unit/pillar-store.test.ts` asserts the live spec's exact clause census, which
      went 38 → 41; re-counted independently with grep, not copied from the failure output
- [x] The janitor is told, on a repo issue, that the spec moved to 1.2.0 and what the two new
      families assert — cross-linking their open ask (janitor#118) and the original request (#85)
      — **DONE**, as a comment ON #85 itself (their own open request, which is the better venue than
      a second thread on their tracker); janitor#118, #73 and #123 cross-linked; both families'
      assertions tabulated so it is actionable without fetching the unpushed branch, and the
      unpushed state is stated rather than glossed.
      → https://github.com/Emasoft/ai-maestro/issues/85#issuecomment-5124165382
- [x] No existing clause id is renumbered or reused — **DONE**, verified: only `3P-DAG-01/-02/-03`
      are new. (An accidental renumber of the `3P-BND` heading's human "Pillar 4" label — not a
      clause id — was caught and reverted before commit.)

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
