---
trdd-id: 8F8PJEXI
title: The mandate check compares a claim to itself — give it an objective floor
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T17:35:51+0200
severity: high
effort: medium
relevant-rules: []
npt: [TGNU1EP7]
eht: []
blocked-by: []
release-via: none
labels: [governance, d4-watchdog, trdd-doctor, 3P-ZON-11]
external-refs: [Emasoft/ai-maestro#59, Emasoft/ai-maestro#47]
---

# The mandate check compares a claim to itself — give it an objective floor

## Problem

`lib/trdd-doctor.ts` implements R41.3's formula as `MANDATE-FORGED`, and reads the floor from the
card's **own frontmatter**:

```ts
const floor = String(c.fm['min-approval-requirement'] ?? 'none').trim().toLowerCase()
const rankBy = AUTHORITY_RANK[by === 'self' ? 'none' : by]
const rankFloor = AUTHORITY_RANK[floor]
} else if (rankBy < rankFloor) { /* MANDATE-FORGED */ }
```

So it compares **declared against declared**. The bypass the rule documents still passes clean:
`min-approval-requirement: none` + `mandate: true` + `mandated-by: self` gives rank 0 against
rank 0, `0 < 0` is false, no finding. The check's own error string names the hole it cannot see:
*"an under-classified floor plus a self-issued mandate bypasses the approval system entirely."*

§D4 step 3 is explicit that the comparison must use *"the corrected floor from step 2, not the
declared value"* — and step 2, the §D3 recomputation, does not exist. Verified: zero references to
`.github`, `golden`/`GOLDEN`, or any floor-derivation symbol in the pillar tooling; the only
occurrence of "objective floor" is a `META-MISSING` message saying the comparison *"has nothing to
compare the objective floor AGAINST"*.

## Root cause

§D3's floors are defined by what a card **touches**, but a TRDD is a design document, not a diff —
and every field describing its reach (`impacts:`, `release-via:`, `relevant-rules:`) is **also
self-declared**. Recomputing from those moves the self-declaration one field across and buys
nothing: an agent that under-declares `min-approval-requirement` will under-declare `impacts:`.

## Proposed fix

Derive the floor from the **changed paths of the commits citing the card** (`implementation-commits:`,
cross-checked against the actual diff), which is the only evidence the author does not control, then
feed that into the existing `MANDATE-FORGED` comparison in place of the declared floor.

This makes the check necessarily **retrospective** — the objective evidence exists only once code
lands. That is consistent with the model rather than a weakness: §D4 already chose a lazy async
audit over a synchronous gate, and a gate walkable by `Edit` is a suggestion with extra steps. The
goal is that a forgery is **found, named, and un-authorized on the next sweep**, not that it is
impossible to write.

Now normative as **3P-ZON-11** (spec 1.7.0), which `MUST`s exactly this and adds that a watchdog
scheduled nowhere satisfies nothing — hence the NPT.

## Verification

A seeded card carrying `min-approval-requirement: none` + `mandated-by: self` whose citing commit
touches `.github/` MUST produce `MANDATE-FORGED`. Complementary neuter: revert the floor to the
declared value and that test MUST go green again, proving the objective floor is what catches it.

## Estimated risk

MED — the check runs over the whole corpus, so a wrong floor derivation produces a wall of false
ERRORs, which is how a linter gets routed around. Ship it reporting-only over the live corpus first
and read the findings before making it fail a build.

⚠ **BLOCKED IN PRACTICE, not by a card:** the fix lands in `lib/trdd-doctor.ts`, which currently
holds another session's uncommitted neuter (`if (semantic)` → `if (true)`, mtime 2026-08-05 10:58).
Editing it would braid this change into their measurement. Wait for that tree to clear.

## Approval log

- 2026-08-05T17:35:51+0200 — MANDATE issued by USER ("write all the TRDDs and the derived TRDDs").
  Pre-approved: issuer authority >= required approver (floor `none`, in-scope tooling work).
  No approval request was sent.
