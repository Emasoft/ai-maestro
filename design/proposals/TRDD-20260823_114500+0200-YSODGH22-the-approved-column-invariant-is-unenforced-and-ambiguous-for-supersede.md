---
trdd-id: YSODGH22
title: the approved column invariant is unenforced and ambiguous for a card superseded after approval
column: proposal
created: 2026-08-23T11:45:00+0200
updated: 2026-08-23T11:45:00+0200
current-owner: ai-maestro-00
created-by: ai-maestro-00
task-type: infra
min-approval-requirement: manager
approved: false
npt: []
eht: []
project-id: ai-maestro
repo: Emasoft/ai-maestro
relevant-rules: []
external-refs: []
---

# the approved column invariant is unenforced and ambiguous for a card superseded after approval

## Problem

`rules/aimaestro/aimaestro-trdd-approval.md` ratifies an invariant binding `approved:` to
`column:`:

```
approved: true       ⟺  column ∉ {proposal, refused, superseded}   (it reached design/tasks/)
approved: rejected   ⟺  column == refused
approved: false      ⟺  column ∈ {proposal, superseded}
```

**Nothing enforces it.** Demonstrated accidentally on 2026-08-23: TRDD-3VFT513C was authored with
`approved: false` + `column: todo` — a Tier-2 card sitting in `design/tasks/`, which is the
overlay's named anti-pattern — and `trddgrep validate` passed it. The state was only caught by an
adversarial review reading the frontmatter by eye.

**But enforcing it as written would be wrong, and that is the more interesting half.** Measured
across the corpus the same day: **327 cards carry both fields, 4 violate the invariant**, and 3 of
the 4 are one shape:

| approved | column | count |
|---|---|---|
| `true` | `superseded` | 3 (APN5WB2L, 9DYUI97S, ZRRDCQ52) |
| `true` | `refused` | 1 (W7B0TC9B — an e2e smoke artifact, sibling of G6A54OYK) |

A card that **was approved**, reached `design/tasks/`, did work, and was **later superseded** by a
newer card is exactly the `true` + `superseded` shape. The invariant demands `approved: false`
there, which would assert that nobody ever approved it — destroying a fact that is true and
recorded. The rule's own prose says a superseded card carries `approved: false` and **no judge**
("nobody declined it, a newer TRDD overtook it") — which describes a **proposal** overtaken before
approval, not a card superseded after it. The rule conflates two different lifecycles that both
end at `superseded`.

So the field cannot carry both meanings: *"was this ever approved?"* and *"is this pending?"*.

## Proposed fix

A ruling is needed before any lint rule, because a rule shipped against the current text would
flag 3 cards that are arguably correct — and "a wall of red is how a linter gets routed around"
is this repo's own recorded lesson.

Options, not ruled in:

1. **Narrow the invariant to the transition, not the state:** `approved: false` is required only
   when a card ENTERS `superseded` from `proposal`. A card superseded from a working column keeps
   `approved: true`. Smallest change to the text; makes the current corpus conformant.
2. **Split the field:** `approved:` records the historical judgement and never flips back;
   pendingness is derived from `column` alone (it already is). Cleanest, and it is a schema
   change.
3. **Accept the current text and repair the 3 cards** — rejected on its face here, since they are
   terminal and frozen, and it would record a falsehood.

Only after the ruling: add the check to `lib/trdd-doctor.ts` and delete this card.

## Verification

Whatever is ruled, the check must be seeded with a violation of EACH arm (`true`/`false`/
`rejected`), because a rule stated over three arms and tested on one is the vacuity this corpus
has been bitten by before. Then a neuter per arm, with observed counts.

## Acceptance

- [ ] a ruling on the `approved: true` + `column: superseded` case
- [ ] `lib/trdd-doctor.ts` enforces whatever is ruled
- [ ] the check is seeded with a violation of each of the three arms, with observed neuter counts
- [ ] the 4 currently-violating cards are either conformant under the new text or explicitly
      ledgered with reasons, never silently excluded

## Approval log
