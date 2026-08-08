---
trdd-id: O16UGID8
title: Bring the ARCHITECT and INTEGRATOR plugins onto the async-approval model (mandate fields, D1 never-block, Tier-0 self-mandates)
column: planned
created: 2026-08-08T12:01:51+0200
updated: 2026-08-08T12:01:51+0200
current-owner: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [fleet-readiness, governance-alignment, role-plugins]
external-refs: []
---

# Bring ARCHITECT + INTEGRATOR onto the async-approval model

## Why (measured 2026-08-08 ~12:00, remote tips 1cd6f2b / ca630f2)

The fleet-readiness sweep found the mandate/approval overlay fields referenced core=12,
programmer=8, maintainer=6 — and **architect=0, integrator=0**. Both plugins carry large
checklist/decision-tree corpora (216 and 213 matching files) that predate the async-approval
model in `rules/aimaestro/aimaestro-trdd-approval.md` (Tier-0 self-mandates, D1 never-block,
`mandate:`/`mandated-by:`/`min-approval-requirement:`, the depth-1 NPT/EHT flock, the
completion gate). An agent whose choice trees assume synchronous approval will WAIT where the
model says author-as-planned-and-proceed — the exact stall class unsupervised operation cannot
afford.

## Scope split (keeps every card Tier-0-honest)

- **THIS card (mine)**: the SPEC below + the work orders to the two live sessions
  (`emasoft-architect-agent-50`, `emasoft-integrator-agent-e4`) + tracking their closure.
- **Their cards (theirs)**: each session authors its OWN Tier-0 TRDD in its own repo and
  implements against this spec — their trees are other projects; I never edit them.

## The spec (what each plugin's docs/skills/choice trees must reflect)

1. **Tier-0 is the default.** In-scope work and derived NPT/EHT are authored directly as
   `column: planned` with `mandate: true`, `mandated-by: self`, `min-approval-requirement:
   none` — no approval round-trip, no waiting. Escalate only on a D3 objective trigger
   (cross-team/repo, release surface, baseline deviation, governance edit → `manager`;
   team-internal coordination → `chief-of-staff`; golden/irreversible → `user`).
2. **D1 never-block**: a Tier-1/2/3 proposal is filed to `design/proposals/` and the agent
   MOVES ON to other work; no spin-waiting on an approver.
3. **The frontmatter fields** appear in every TRDD the plugin's skills author or teach:
   `min-approval-requirement:` (never the deprecated `approval-tier: N`), `mandate:`,
   `mandated-by:`, and for derived cards `derived: true` + `derived-kind:` + `parent-trdd:`
   with EMPTY npt/eht (depth-1).
4. **Completion gate**: a card is `complete` only when its checklist exists (≥1 box) and is
   fully checked AND every npt/eht child is terminal; otherwise `blocked` with `blocked-by:`.
5. **Choice trees updated, not appended**: wherever a checklist or decision tree says "request
   approval and wait" for in-scope work, it is REWRITTEN to the Tier-0 shape — a correct new
   rule beside a stale old tree leaves the agent following the tree.

## Verification

- Each repo's published tip greps ≥1 skill/agent file carrying `min-approval-requirement`
  AND `mandate:` in TRDD-authoring guidance.
- Zero remaining "wait for approval" instructions on in-scope/Tier-0 paths (each session
  reports the grep it ran and its count, with the population stated).
- Their closure messages carry release tag + tip sha (TYPE + REPO + REACHABILITY +
  WHEN-MEASURED, timestamps pasted).

## Acceptance

- [ ] Work orders sent to both sessions citing this card (2026-08-08)
- [ ] Architect repo published with the refresh; verified against its remote tip by me
- [ ] Integrator repo published with the refresh; verified against its remote tip by me

## Approval log
