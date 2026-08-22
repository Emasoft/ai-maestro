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
