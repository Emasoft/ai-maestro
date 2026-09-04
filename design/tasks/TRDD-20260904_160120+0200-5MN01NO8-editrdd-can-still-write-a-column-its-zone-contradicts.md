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

`advanceColumn` is worth a second look during implementation: it gates on the card being in
`tasks/` but is the function that legitimately writes terminal columns, so whether it can leave a
terminal column in the OPEN zone without the `git mv` is the same question one level along. Do not
assume either way — it was not measured here.

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
