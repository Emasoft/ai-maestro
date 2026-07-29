---
trdd-id: MUYRIKN3
title: The 3-pillars spec bump is consumed by the janitor and must reach it
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T00:36:48+0200
implementation-commits: [89810d4b]
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

## HALF LANDED 2026-07-30 (`89810d4b`) — `3P-DAG` is in, `3P-IDX` is not

The `3P-DAG` family (3 clauses) landed with the stamp at **1.2.0**, via NPT `LXLK7XGX`. **`3P-IDX`
does not exist** — Phase 5's index shipped (`freshness.ts`, `index-db.ts`, `index-build.ts`,
`index-open.ts`, the 10-point memgrep contract, the edges table) and was **never spec'd**. So box 2
is genuinely unmet, not a bookkeeping lag: it demands the cheat-sheet list BOTH families.

**Why the notification (box 4) waits rather than going out now.** A correction to a fact this flock
had been carrying: `governance-rules` is NOT remote-less — its upstream is `fork/governance-rules`.
But it is **65 commits behind local**, so `spec-version: 1.2.0` exists on no remote and NO consumer
can read it. `3P-VER-02`'s "declared version ≠ this file's version is a DETECTABLE conformance
failure" therefore cannot fire yet. Telling the janitor now would mean announcing a 1.2.0 that (a)
they cannot fetch and (b) is still going to gain a second family — two bumps and two messages for
one release. So: land `3P-IDX` into the SAME 1.2.0 (free — nobody has seen it), then notify once.

**Bounded risk, stated so it is not forgotten:** if `3P-IDX` stalls, box 4 must go out ANYWAY before
this branch is pushed. The harm this card exists to prevent begins at push, not at bump.

## Acceptance

- [x] `spec-version: 1.2.0`, and every new clause carries a stable `3P-<FAMILY>-NN` anchor plus a
      bold key-phrase at line start (`3P-MNT-03`) — **DONE** (`89810d4b`); the anchors are pinned by
      the conformance test's family array, proven by a neuter run on `3P-DAG-01`
- [ ] `3P-GREP`'s family list includes `IDX` and `DAG` — the cheat-sheet must list every family
      — **HALF: `DAG` listed (`DAG=reference-dag`); `IDX` does not exist yet.** Phase 5's index is
      built and unspec'd, so this is the remaining substantive work on this card
- [x] `tests/unit/three-pillars-spec-conformance.test.ts` updated and green — **DONE**: `'DAG'` added
      to the family array (4/4 green). The same change surfaced a SECOND consumer the card never
      named — `tests/unit/pillar-store.test.ts` asserts the live spec's exact clause census, which
      went 38 → 41; re-counted independently with grep, not copied from the failure output
- [ ] The janitor is told, on a repo issue, that the spec moved to 1.2.0 and what the two new
      families assert — cross-linking their open ask (janitor#118) and the original request (#85)
      — **held until `3P-IDX` lands, see above; must not outlive the first push of this branch**
- [x] No existing clause id is renumbered or reused — **DONE**, verified: only `3P-DAG-01/-02/-03`
      are new. (An accidental renumber of the `3P-BND` heading's human "Pillar 4" label — not a
      clause id — was caught and reverted before commit.)

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
