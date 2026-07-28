---
trdd-id: MUYRIKN3
title: The 3-pillars spec bump is consumed by the janitor and must reach it
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
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

## Acceptance

- [ ] `spec-version: 1.2.0`, and every new clause carries a stable `3P-<FAMILY>-NN` anchor plus a
      bold key-phrase at line start (`3P-MNT-03`)
- [ ] `3P-GREP`'s family list includes `IDX` and `DAG` — the cheat-sheet must list every family
- [ ] `tests/unit/three-pillars-spec-conformance.test.ts` updated and green
- [ ] The janitor is told, on a repo issue, that the spec moved to 1.2.0 and what the two new
      families assert — cross-linking their open ask (janitor#118) and the original request (#85)
- [ ] No existing clause id is renumbered or reused

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
