---
trdd-id: 36RGLVYH
title: 167 archived cards sit at a column the eligible set does not admit and no tool enforces the clause
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:37:04+0200
updated: 2026-08-16T20:37:04+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T20:37:04+0200
derived: true
derived-kind: eht
parent-trdd: BRRJK57P
npt: []
eht: []
blocked-by: []
release-via: none
priority: 3
severity: low
effort: L
labels: [governance, trdd, kanban, hub-self-audit]
external-refs: []
---

# A MUST clause with 167 violations and zero enforcement

## Problem

`3P-ZON-05` names the archive-eligible set. **167 of 249 archived cards carry `column: complete`,
which that set does not admit** — and **no tool references the clause at all**.

The zero was positive-controlled before it was believed: sibling clause `3P-ZON-11` has **8**
references and `3P-AAA-01` has **10**, so the search reaches the corpus and the zero is real rather
than a dead instrument.

Broadened, the picture is larger than one clause: **80 clauses declared, 14 referenced, 66
unreferenced — 27 of those `MUST`.** So this is one instance of a general condition, not an isolated
lapse.

## Root cause

Not measured. The plausible mechanism is that archive eligibility is a function of **both** `column:`
and `release-via:`, and a card whose work is finished reads naturally as `complete` — so the honest
value and the eligible value diverge exactly where a human would not notice. That is a hypothesis;
the card must not build on it.

## Why this is priority 3 and not priority 1

**Nothing is broken.** These cards are archived, terminal, and frozen. The harm is that a MUST
clause with 167 standing violations and no enforcement is indistinguishable from a clause nobody
means — which is how the *next* clause gets ignored too.

## Proposed fix — and the thing this card exists to FORBID

**Do not script this.** The repair is a per-card judgement, and the last confident mass-archive
ruling in this repo **mis-archived 8 cards**. A sweep over prose it cannot parse destroys the audit
trail it was meant to repair.

Two independent tracks, and the second is worth more than the first:

1. **Enforcement first, repair second.** A clause that nothing checks will re-accumulate violations
   the moment anyone stops watching, so repairing 167 cards while the gate stays absent buys one
   clean afternoon. Add the check to `trddgrep validate` / `trdd:doctor` — **with the grandfather
   boundary stated explicitly in the check itself**, since terminal cards are frozen and cannot be
   repaired, and a linter that reddens on 167 unfixable cards is a linter people route around.
2. **Then classify** the 167 by hand, in batches, recording per card which of *done / superseded /
   cancelled / mis-columned* it actually is. Frozen means the column may not change — so for most
   of them the correct outcome is a **recorded classification, not an edit.**

The wider finding — 66 unreferenced clauses, 27 of them `MUST` — is deliberately **not** in scope
here. It needs its own card and its own instrument, and folding it in would produce exactly the
kind of unbounded sweep this card forbids.

## Verification

- The new check exists, is wired into a gate that actually runs, and **fails on a seeded
  violation** — a gate nobody has watched fail is not a gate.
- Its grandfather boundary is explicit and dated, so a reader can tell "pre-existing, frozen" from
  "new, must fix" without reading history.
- The classification of the 167 is recorded and **auditable per card**, not summarized as a count.

## Estimated risk

LOW for track 1. **HIGH for any scripted attempt at track 2** — which is the entire reason this card
is written the way it is.

## Approval log

- 2026-08-16T20:37:04+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: Tier-0 — this repo's own governance corpus and its own linters, and the card commits
  to recording rather than mutating frozen cards. Derived (EHT) from TRDD-BRRJK57P's axis-2 pass. No
  approval request was sent.
