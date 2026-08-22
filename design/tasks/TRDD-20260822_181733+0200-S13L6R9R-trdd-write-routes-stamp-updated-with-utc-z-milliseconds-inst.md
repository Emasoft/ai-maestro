---
trdd-id: S13L6R9R
title: TRDD write routes stamp updated with UTC-Z milliseconds instead of the mandated local offset
column: todo
created: 2026-08-22T18:17:33+0200
updated: 2026-08-22T18:17:33+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:17:33+0200
---

# TRDD write routes stamp updated with UTC-Z milliseconds instead of the mandated local offset

## Problem

Five TRDD write routes stamp `updated:` with raw `new Date().toISOString()`, which always yields
UTC-`Z` **with milliseconds** — a format the TRDD rule does not admit and the corpus does not use.

```
app/api/trdd/[id]/route.ts:88          editTrdd(designDir, id, edits, new Date().toISOString())
app/api/trdd/[id]/archive/route.ts:69  iso: new Date().toISOString(),
app/api/trdd/[id]/promote/route.ts:53  iso: new Date().toISOString(),
app/api/trdd/[id]/refuse/route.ts:53   iso: new Date().toISOString(),
app/api/trdd/[id]/approve/route.ts:72  iso: new Date().toISOString(),
```

`~/.claude/rules/trdd-design-tasks.md` §4: *"Dates are ISO 8601 with the local offset
(`%Y-%m-%dT%H:%M:%S%z`)"*. `2026-08-22T16:16:25.886Z` is neither — wrong zone form, plus a
sub-second field the format has no slot for.

**This is not a style quibble; the codebase already knows the right answer and applies it in one
place only.** `lib/trdd-doctor.ts:1141` writes its stamp as:

```ts
const stamp = opts.now ?? new Date().toISOString().replace(/\.\d+Z$/, '+0000')
```

So the `.replace` exists precisely because raw `toISOString()` is wrong here — and the five write
routes never got it. One codebase, two conventions, and the routes carry the non-conformant one.
(The doctor's `+0000` conforms in SHAPE but is still UTC; the corpus convention is the LOCAL
offset. Fixing the routes should produce the local offset, not merely copy the doctor.)

## Measured impact

```
$ grep -hE '^updated: .*Z$'            design/{tasks,archived,proposals}/*.md | wc -l   →  10
$ grep -hE '^updated: .*[+-][0-9]{4}$' design/{tasks,archived,proposals}/*.md | wc -l   → 481
```

**All 10 were written TODAY (2026-08-22) by these routes**, during one session of `promote` /
`archive` calls: `8I0JUCK9 P7XKV3N9 WF0UE9BC CC9PY337 7U927FCM CJWC3JLU K2WJH7RF 99LV0U4I A9335BZ6
G6A54OYK`. Before today the corpus was 100% offset-form. So the drift is not historical residue —
it is the write verbs, and it grows by one card per call, indefinitely.

## Why nothing catches it

Neither gate looks at the format:

- `trddgrep validate` — 2 ERRORs, both pre-existing and unrelated (`G6A54OYK`, `7123D51A`); zero
  findings on any of the 10.
- `yarn trdd:doctor` — 494 scanned; not one `updated:`-format finding.

A drift no gate sees, introduced by the sanctioned tool, in the field the board SORTS on. It is
benign today only because `Date.parse` accepts both.

## Proposed fix

1. One helper — `isoLocalStamp()` returning `%Y-%m-%dT%H:%M:%S%z` — and route all five write sites
   plus `trdd-doctor.ts:1141` through it, so there is ONE definition rather than two that drift
   (the doctor's inline `.replace` is the second one already).
2. A doctor rule `UPDATED-FORMAT` flagging any `created:`/`updated:` that is not
   `%Y-%m-%dT%H:%M:%S±HHMM`, `--fix`-able. Without it the class recurs the moment a sixth write
   route is added — the fix above is per-site and a rule is per-class.
3. Backfill the 10 (a `--fix` pass), NOT by hand.

**Do not "fix" this by widening the rule to accept `Z`.** The local offset is what lets a human tie
a card to their own workday without timezone arithmetic (the same reason `agent-reports-location.md`
mandates `%z` for every dated filename), and 481 cards already carry it.

## Verification

- `grep -cE '^updated: .*Z$' design/{tasks,archived,proposals}/*.md` → **0**
- A `promote` call through the CLI writes an offset-form `updated:`, read back from the file.
- `yarn trdd:doctor` reports `UPDATED-FORMAT` on a seeded `Z` stamp and clean after `--fix`
  (a rule with no positive control is a rule that cannot be shown to fire).

## Approval log

- 2026-08-22T18:17:33+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Re-measured on pickup — 2026-08-22T20:25:02+0200

The card's own numbers had drifted, which is the card's thesis demonstrating itself.

| the card says | re-measured now |
|---|---|
| 10 `Z`-form `updated:` stamps | **23** |
| 481 offset-form | **478** |
| 5 write sites | **5 confirmed** |

**The Z count more than doubled in ~2 hours** — written by `promote`/`archive` calls between the
card's authoring (18:17) and its pickup. That is the card's *"grows by one card per call,
indefinitely"* claim, observed rather than predicted.

**A sixth candidate site, checked and RULED OUT:** `app/api/trdd/kanban/route.ts:32` passes
`new Date().toISOString()` to `getKanbanIndex` — a **GET** route using it as a read timestamp for
the index. It never writes `updated:`. In scope for the grep, out of scope for the bug.

**And the helper the card asks me to write ALREADY EXISTS.** `lib/trdd-create.ts:64` has a private
`function isoNow(): { iso: string; stamp: string }` returning exactly both forms needed — the
local-offset ISO string AND the `YYYYMMDD_HHMMSS±HHMM` filename stamp. It is simply not exported.
So step 1 is **export the existing function**, not author `isoLocalStamp()`: fewer files, and it
satisfies the card's own *"ONE definition rather than two that drift"* better than a new one would.

(Noted, NOT actioned: ~5 further re-implementations of the `-d.getTimezoneOffset()` pattern exist
across `lib/` — janitor-daemon-publisher, janitor-status-archive, oauth-rotator/slots and
/decision-log, services/auto-update-service, lib/session-export. They serve unrelated subsystems;
consolidating them is a separate, unmandated refactor and is deliberately out of this card's scope.)

## Acceptance

This card carried **zero checkboxes**, which makes the completion gate vacuous — a terminal column
with no boxes passes having proven nothing (`lib/trdd-doctor.ts::countAcceptanceBoxes` counts
boxes, and every box in an empty set is trivially checked). Adding the gate the card needs:

- [ ] the local-offset stamp has exactly ONE definition, reached by all five write routes and by `lib/trdd-doctor.ts:1141`
- [ ] `grep -cE '^updated: .*Z$'` over `design/{tasks,archived,proposals}` → **0**
- [ ] a live write verb (`promote` or `archive`) produces an offset-form `updated:`, read back from the file on disk — not from the route's return value
- [ ] a doctor rule flags a seeded `Z` stamp and is clean after `--fix` — with the positive control run recorded, since a rule that cannot be shown to fire is not a rule
- [ ] the rule REFUSES to rewrite a terminal-column card's body (IND §12 freeze) — or its exemption is stated and justified
- [ ] the 23 drifted cards are backfilled by `--fix`, never by hand
- [ ] `updated:` is NOT bumped on the backfilled cards — a format repair changes no fact, and bumping it would silently reorder the whole board

## Design finding on pickup — the repair must CONVERT the instant, not stamp `now`

Read `lib/trdd-doctor.ts:1399-1421` before implementing. The doctor already carries the guard this
card's acceptance box was reaching for, and it is sharper than "do not bump":

```ts
if (semantic) {                                   // MECHANICAL repairs leave updated: byte-identical
  text = text.replace(/^updated:.*$/m, `updated: ${stamp}`)
}
```

Its comment records that this line USED to bump on any repair, that a corpus-wide `yarn trdd:fix`
therefore *"reordered the view every human and agent reads into an artefact of when someone last ran
a formatter"*, and that keeping `updated:` byte-identical across a mechanical run is *"the only
cheap proof, afterwards, that the run WAS mechanical."*

**So the new rule cannot use that path at all, and the reason is the whole design.** An
`UPDATED-FORMAT` repair must REWRITE `updated:` — that is its entire job — while being
**MECHANICAL**, because it changes no fact. The existing `semantic` flag cannot express that: `false`
means *do not touch `updated:`*, and this repair touches nothing else.

**The rewrite must therefore happen inside the repair's own `changes`, and it must CONVERT the
existing instant rather than stamp `now`:**

| | |
|---|---|
| ❌ `updated: <now, offset form>` | destroys the original instant and reorders the board — the exact damage the comment above records, arriving by a new route |
| ✅ `2026-08-22T16:16:25.886Z` → `2026-08-22T18:16:25+0200` | same instant, correct notation, board order preserved |

**And it is not perfectly lossless — say so rather than discover it.** The live stamps carry
milliseconds (`…T15:31:24.411Z`, `…T17:02:57.700Z`, `…T16:39:41.567Z`); the mandated format has
no sub-second slot, so the conversion TRUNCATES to the second. That is a real, sub-second, one-way
loss on 23 cards. It is acceptable — the format the corpus sorts on has never carried milliseconds,
and 478 cards already lack them — but it must be a stated decision, not an accident.

**Corrected acceptance box.** The one above reading *"`updated:` is NOT bumped on the backfilled
cards"* was right in intent and wrong in mechanism — it implied leaving the field alone, which
cannot fix a format defect in that field. Superseded by:

- [ ] the backfill CONVERTS each existing instant to the local-offset form (same wall-clock moment, truncated to the second) and does **not** substitute `now` — proved by comparing each card's before/after epoch, which must differ by less than one second
- [ ] the repair is classified `mechanical`, so no OTHER field's bump logic fires on it
- [ ] board order over the 23 is unchanged after the backfill — the sort is the thing being protected, so it is the thing to assert

## Blast radius re-measured — 2026-08-22T20:34:00+0200 — THREE targets, not one, and 18 of the cards are FROZEN

The card measures `updated:` only. Reading `lib/trdd-store.ts` shows the same bad `iso` is
written to **three** places per call:

```
:353,:363   { ...fields, updated: iso }         → the updated: frontmatter field
:589,:592   ['updated', …], ['approval-datetime', …]
:602,:632   `- ${opts.iso} — APPROVED by …`     → a PROSE line in ## Approval log
```

Measured across all four zones:

| target | Z-form | offset-form (control) |
|---|---|---|
| `updated:` | **24** | 502 |
| `created:` | 0 | — |
| `approval-datetime:` | **1** | — |
| `## Approval log` prose lines | **36** | 764 |

**61 sites across 3 targets, not 23 across 1** — and the largest population is the one the card does
not mention. (`updated:` also went 23 → 24 during this pickup: the drift is live.)

**Two things this changes about the plan, both load-bearing:**

1. **The approval-log lines are PROSE, not a field.** A frontmatter repair is a keyed replace; a
   prose repair is a scripted bulk edit over text a regex cannot fully parse — this corpus's own
   lesson (*"a scripted bulk edit over PROSE destroys what its regex cannot parse"*) was earned on
   exactly that. The 36 must be repaired by an anchored, single-purpose rule that rewrites ONLY the
   leading `- <ISO> — ` token and touches nothing after the em-dash, or not at all.

2. **18 of the affected cards are TERMINAL and therefore FROZEN** (17 `completed`, 1 `refused`)
   against 6 open ones. IND §12 freezes a terminal card's body — **but `## Approval log` is
   explicitly EXEMPT (append-only)**, and a format repair of a line already in it is neither an
   append nor a fact change. That exemption is written for ADDING lines, not REWRITING them, so it
   does not obviously cover this. **This is the one question on the card I cannot settle from the
   rules as written, and it must be settled before any `--fix` runs**, because the alternative
   readings differ by 18 frozen cards.

**Recommendation, pending that ruling:** land the WRITE-side fix (so the drift stops growing) and
the doctor RULE (so the class is detected) **first**, and gate the BACKFILL of the 36 prose lines
and the 18 frozen cards behind the freeze ruling. Stopping the bleed does not require deciding the
frozen-card question; conflating them would hold a safe fix hostage to an unsettled one.

- [ ] the freeze question is ruled on before any backfill touches a terminal card
- [ ] the approval-log repair rewrites ONLY the leading `- <ISO> — ` token, proved by asserting the post-em-dash remainder is byte-identical
- [ ] the write-side fix and the doctor rule land INDEPENDENTLY of the backfill

## Placement settled by the import graph — 2026-08-22T20:38:30+0200 — and my own proposal was WRONG

I proposed *"export the existing `isoNow()` from `lib/trdd-create.ts`"* and asked the advisor to
attack it. The dependency graph answers it without an opinion:

```
lib/trdd-create.ts:23   import { TRDD_ZONES, type TrddZone } from '@/lib/trdd-store'
lib/trdd-store.ts       …imports pillar/*, trdd-edit-guard — NOT trdd-create
consumers:              trdd-create → 1 (the create route) · trdd-store → 14
```

**The direction is already `create → store`.** So exporting `isoNow()` from `trdd-create` and
importing it into `trdd-store` — which is what my plan required, since `trdd-store` is where all
three write targets live — would **REVERSE that edge and create an import cycle**
(`store → create → store`). My proposal was not merely stylistically off; it was structurally
impossible in the direction it needed to go.

**Correct placement: MOVE `isoNow()` into `lib/trdd-store.ts` and export it; `trdd-create`
imports it from there.** That follows the existing edge, adds no file, puts the helper in the module
that actually performs all three writes, and yields the ONE definition the card asks for. A third
`lib/trdd-stamp.ts` would also work and costs an extra module for one function — rejected as
unnecessary, not as wrong.

**Why this is worth recording rather than just doing:** the ladder's *"reuse what already exists"*
rung pointed at `trdd-create` because that is where the function IS, and reuse-in-place is normally
the lazy correct answer. Here it would have produced a cycle. **The reuse rung tells you WHAT to
reuse; the import graph tells you WHERE it may live, and only the second one is checkable.** One
grep of two import blocks settled a question I had escalated to an advisor.

- [ ] `isoNow()` lives in `lib/trdd-store.ts`, exported, with `trdd-create` importing it — no new module, no cycle
- [ ] `npx tsc --noEmit` clean (a cycle is exactly what a type-check catches, so this box is the proof)
