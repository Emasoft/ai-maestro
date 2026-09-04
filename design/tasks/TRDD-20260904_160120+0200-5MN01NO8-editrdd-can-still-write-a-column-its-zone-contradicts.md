---
trdd-id: 5MN01NO8
title: editTrdd can still write a column its zone contradicts — the half MWKCBLQN did not close
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T16:01:20+0200
updated: 2026-09-04T16:01:20+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
priority: 2
severity: medium
effort: medium
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-04T16:01:20+0200
derived: true
derived-kind: eht
parent-trdd: MWKCBLQN
relevant-rules: [R25]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

# editTrdd can still write a column its zone contradicts — the half MWKCBLQN did not close

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-09-04

TRDD-MWKCBLQN closed the MINT path (`createTrdd` now refuses a column whose `expectedZone`
disagrees with the zone it is writing into). **The EDIT path is still open**, and it produces the
same inert card the parent card is titled after. Nothing is broken that was not broken before —
this is an EHT for a hole the parent's fix REVEALED, not one it introduced.

NEXT ACTION: decide where the zone check belongs (see "Why this is not a three-line fix"), then
implement with a neuter proving the new refusal fires.

## The defect, measured

`lib/trdd-edit-guard.ts::validateTrddFieldEdits` is the shared predicate behind `editTrdd`
(`lib/trdd-store.ts:395`, which writes arbitrary fields through `setFrontmatterField` at `:418`).
Its column rule is `:139`:

```ts
if ('column' in fields && !VALID_COLUMNS.includes(resultColumn)) { … refuse … }
```

`VALID_COLUMNS` is `[...DEFAULT_STATUSES, ...BRACKET_COLUMNS]` (`lib/trdd-vocabulary.ts:51`), and
`BRACKET_COLUMNS` includes `proposal`, `refused`, `completed`, `cancelled` (`:50`). So a write of
`column: proposal` onto a card living in `design/tasks/` PASSES — the identical hole MWKCBLQN
reports, on a different write path.

**The decisive measurement:** `grep -c expectedZone lib/trdd-edit-guard.ts` → **0**, and the file
contains no reference to `zone` at all. The guard polices the terminal-column freeze, column
presence, the ratified vocabulary, and the `blocked-by` ⟺ `blocked` invariant. It has no notion of
which zone the card sits in, so it cannot check agreement.

## The asymmetry, measured — CREATE is guarded twice, EDIT zero times

A review asked the right question: is this hole already closed one layer up, by the same
post-write `validateTrddCandidate` gate the CLI runs after `create`? **No — and the contrast is
the clearest statement of the defect.**

| path | mint/edit-time zone check | post-write candidate gate |
|---|---|---|
| **create** | YES (TRDD-MWKCBLQN, `lib/trdd-create.ts`) | YES — `scripts/trddgrep.mjs:1065` runs `validateTrddCandidate`, which calls `expectedZone` (`lib/pillar/trdd-candidate.ts:75`) and DELETES the file on violation |
| **edit** | **NO** | **NO** |

Measured: `grep -c expectedZone` returns **0** for `app/api/trdd/[id]/route.ts` and **0** for
`lib/trdd-edit-guard.ts`, and the CLI's edit verb (`scripts/trddgrep.mjs:625-665`) calls no
candidate validation at all — `validateTrddCandidate` is imported at `:991` and used only at
`:1065`, both inside the create block.

So the edit path has no zone check at ANY layer. That also answers where the fix belongs: adding
one is not duplicating a gate that already exists elsewhere on this path.

**And `move` — the verb the 409 points users to — is CORRECT, which completes the picture.**
`scripts/trddgrep.mjs:1213` imports `expectedZone` and `:1229` computes
`const want = expectedZone(targetColumn, card.frontmatter ?? {}) ?? 'tasks'`, then dispatches to
the verb that OWNS that zone move — `archiveTrdd`, `refuseTrdd`, `promoteTrdd`, or `advanceColumn`.
Its own comment says why: *"`expectedZone` is the arbiter, not a table local to this file."*

**CORRECTED — the first version of this table credited the guard to the CALLER.** It listed one
row as "`trddgrep move` → promote/refuse/archive/advance | YES (`scripts/trddgrep.mjs:1229`)",
which asserts a property of three library functions on the strength of one consumer. A review
caught the shape and predicted the consequence: `app/api/trdd/[id]/{promote,refuse,archive}`
call those functions DIRECTLY, bypassing `move`'s dispatch, so they would be unguarded.

**The shape criticism is right; the prediction is REFUTED.** Each verb enforces zone at its OWN
layer, measured in `lib/trdd-store.ts`:

| writer | writes `column`? | zone enforced, and WHERE |
|---|---|---|
| `setTrddField` (`:885`) | no | 409 — refuses `field === 'column'` outright (`:894`) |
| `promoteTrdd` (`:659`) | yes | 409 unless `zone === 'proposals'` (`:667`) |
| `refuseTrdd` (`:708`) | yes | 409 unless `zone === 'proposals'` (`:716`) |
| `advanceColumn` (`:752`) | yes (`:814`) | **calls `expectedZone` itself (`:801`)**, 409 when `wantZone !== 'tasks'` (`:802-807`) |
| `archiveTrdd` (`:1022`) | yes | 409 if already terminal (`:1037`), plus further 409 gates |
| `createTrdd` | yes | `expectedZone` (TRDD-MWKCBLQN) + the CLI's post-write gate |
| **`editTrdd` (`:395`)** | **yes** | **NONE — this card** |

So the four API routes are safe BY CONSTRUCTION, because the library guards rather than because
the CLI does — and `trddgrep move`'s `:1229` dispatch is a convenience on top of guards that hold
without it. This also retires the "not measured" flag this card carried on `advanceColumn`: it is
measured, and it is guarded. The table and the prose no longer disagree.

That makes the finding SHARPER, not weaker: `editTrdd` is the only one of SEVEN write surfaces
with no zone check — not a path the design left open, an omission.

## The other four write surfaces, since a half-census is what caused this

`lib/trdd-store.ts` is **1086 lines** and exports five functions that write frontmatter. Measured
(`grep -n "^export function" lib/trdd-store.ts`):

| writer | writes `column`? | zone/column agreement checked? |
|---|---|---|
| `setTrddField` (`:885`) | **NO** — returns 409, "refusing to set `column:` directly" | n/a, it refuses |
| `editTrdd` (`:395`) | **YES**, via `validateTrddFieldEdits` | **NO — this card** |
| `advanceColumn` (`:752`) | YES (`:814`) | partially — refuses unless `trdd.zone === 'tasks'` |
| `promoteTrdd` (`:659`) | YES | owns its own zone move (`proposal → planned`) |
| `refuseTrdd` (`:708`) | YES | owns its own zone move (→ `refused/`) |

**`advanceColumn` — MEASURED, and it is guarded.** This paragraph originally said "do not assume
either way — it was not measured here", which was the honest state at the time. It has since been
measured (see the corrected table above): `lib/trdd-store.ts:801` calls `expectedZone` and
`:802-807` returns 409 — *"Column X belongs in design/<zone>/, not tasks/ — advance does not move
folders; use the promote/refuse/archive verb for that transition"*. So it cannot leave a terminal
column in the OPEN zone. The open question is closed; the table above is the authority.

## Why this is not a three-line fix

The obvious repair — call `expectedZone(resultColumn, merged)` and compare — needs the card's ZONE,
and `validateTrddFieldEdits(fields, currentFrontmatter, refExists)` is not given it. Threading a
zone parameter touches the shared guard and every caller, and the guard is deliberately a pure leaf
(`lib/pillar/` imports it precisely so a corpus walker does not end up behind every write). So the
choice is: pass the zone in, or check agreement in `editTrdd` where the zone is already known
(`trdd.zone` from `findTrdd`) and leave the leaf pure. The second is smaller and keeps the leaf's
stated property; it also means a future third caller of the guard would not inherit the check.

## Verification

- A test writing `column: proposal` via `editTrdd` to a card in `tasks/` is REFUSED.
- A legitimate working-column edit (`dev` → `testing`) still succeeds — positive control.
- NEUTER: remove the new check and the refusal test must redden, naming itself.
- The existing `trdd-edit-guard` / `editTrdd` suites stay green, and their green must be shown to
  be non-vacuous for this case — the parent card's own lesson was that a pre-existing suite which
  never reaches a guard passes identically with or without it.

## How this was found

A review fork asked whether my `setTrddField` clearance in TRDD-MWKCBLQN's caller census covered
the whole file, noting I had read 40 lines and never checked its length. It is 1086. The census
sentence "the third write surface refuses column writes outright" named ONE writer and read as a
statement about the file — the same over-generalisation from an examined instance that this session
hit repeatedly. The fork could not run the grep; the grep is what found this.

## Approval log

- 2026-09-04T16:01:20+0200 — Tier 0 self-mandate (`min-approval-requirement: none`): an EHT closing
  a hole in this session's own change, no governance surface. Filed rather than fixed in place
  because the repair needs a design choice about where the zone check lives.
