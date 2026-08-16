---
trdd-id: 36RGLVYH
title: The archive-eligible clause contradicts itself and the corpus split 168 to 74 along it
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:37:04+0200
updated: 2026-08-16T21:52:15+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: docs
min-approval-requirement: manager
mandate: false
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

## INVESTIGATION 2026-08-16 — it is NOT 167 violations. The clause contradicts ITSELF.

Track 1 said *enforcement first*. Reading `3P-ZON-05` before encoding it — the discipline that
exists precisely for this — found that **the clause cannot be encoded as written.**

```
3P-ZON-05 … only `completed | cancelled | superseded | published | live` may enter archived/.
          … An absent `release-via:` defaults to `none` (terminal `complete`).
```

**The admitted set says `completed`. The next sentence, inside the same clause, says the
`release-via: none` terminal is `complete`.** Two different strings, four lines apart, and a machine
check must pick one.

It is not a typo — **two vocabularies genuinely coexist across the rule corpus**:

| vocabulary | where | spelling |
|---|---|---|
| the ratified **17-column pipeline** | `universal-kanban.md` | `… → **complete** → publish → published → deploy → live` |
| the **folder-lifecycle** terminals | `trdd-design-tasks.md:109`, this clause's set | `proposal, planned, refused, cancelled, **completed**, superseded` |

**Neither document states the mapping.** A card finishing its pipeline reaches `complete`; the
archive admits `completed`; nowhere is it written that archival rewrites one to the other. The
reader has to infer it.

**The corpus shows exactly that split — and it is not 167 to 0:**

```
168  column: complete        <- including one I archived TONIGHT, hours after filing this card
 74  column: completed
  5  column: cancelled
  3  column: superseded
```

**74 cards used the admitted spelling; 168 used the pipeline spelling.** That is not mass
non-compliance, it is a corpus split down an ambiguity — and it explains the finding this card was
built on. **No tool references `3P-ZON-05` because the clause disagrees with itself**, so there is
nothing coherent to encode. The zero was a symptom, not the disease.

**Had I built track 1's check from the admitted set, it would have reddened 168 frozen cards** —
against a spelling the *same clause* endorses one sentence later. The wall of warnings this card
warned about, produced by this card's own plan.

**REVISED ACTION, and it is no longer mine to take.** The fix is not a linter, it is a **ruling**:
which spelling is canonical at archival, and does archival rewrite `complete` → `completed`? That
is a governance-spec edit — the D3 floor puts a spec/governance change at **`manager`**, not
`none` — so this card stops at the finding and the question. A check can be written the moment the
answer exists, and not before; encoding either spelling now would silently ratify one by
implementation.

**Not repaired, and the frozen cards stay frozen** — including my own `5TELESBL` from tonight, whose
spelling is precisely what is in question.

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
