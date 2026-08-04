---
trdd-id: 5XJWR473
title: readDocument cannot signal unparseable, so trdd-doctor --fix duplicates fields on every run
column: complete
created: 2026-08-04T19:35:33+0200
updated: 2026-08-04T19:43:23+0200
implementation-commits: [8c0c459d]
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: bugfix
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T19:35:33+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 1
severity: high
effort: medium
release-via: none
labels: [pillar-tooling, lenient-reader, data-integrity]
---

# readDocument cannot signal unparseable, so trdd-doctor --fix duplicates fields on every run

## Problem

`lib/pillar/store.ts:163-167` swallows a frontmatter parse failure into an EMPTY object:

```ts
try {
  const parsed = matter(raw, NO_MATTER_CACHE)
  data = (parsed.data ?? {}) as Record<string, unknown>
  content = parsed.content ?? ''
} catch {
  data = {}
  content = raw
}
```

So `frontmatter: {}` means either *"this document has no fields"* or *"this document's YAML is
broken and I could not read it"*, and **no caller can tell which** — verified: every call site
(`lib/trdd-store.ts:130`, `lib/pillar/index-build.ts:139`, `store.ts:212`, `store.ts:272`) takes
the object at face value.

`lib/trdd-doctor.ts` then WRITES on that reading:

```ts
if (!c.column && !statusIsPipelineState) {
  text = text.replace(/^(trdd-id:.*)$/m, `$1\ncolumn: todo`)
}
…
if (!c.title) {
  text = text.replace(/^(trdd-id:.*)$/m, `$1\ntitle: ${…}`)
}
```

On a card whose YAML does not parse, both conditions are true — the real `column:` and `title:`
are sitting right there in the file, unparsed — so `--fix` inserts a **second** pair immediately
after `trdd-id:`. The insertion does not make the YAML parseable, so **the next run parses `{}`
again and appends another pair**. Unbounded duplication, on the tool whose entire job is to keep
the corpus honest.

## Root cause

This is the **lenient-reader** shape, and its two halves behave exactly as that pattern predicts:
the READ side is vacuous (every failure looks like an empty document) and the WRITE side built on
it is destructive. It is the same defect class as the `loadJsonSafe` family, one layer over.

Worth recording because it is the part that makes this hard to spot: the comment directly above
the insertion is *careful*. It reasons precisely about why the condition must be
`!statusIsPipelineState` rather than `status === undefined`, so the two branches are complements
and no card falls through both. Real thought went into the LOGIC while the INPUT it reasons about
could be a lie. A reviewer reading that block sees diligence, not a gap.

## Proposed fix

Make the reader able to say "I could not parse this", and make every caller decide:

- Return the failure explicitly — a `parseError?: Error` (or a `frontmatter: null` distinct from
  `{}`) on `PillarDocument`. Do NOT throw: `walkDocuments` streams the whole corpus and one bad
  card must not abort a sweep.
- `trdd-doctor` **refuses to autofix** a document it could not parse, and REPORTS it as a finding
  instead. A card whose frontmatter is broken needs a human; inserting fields is a guess.
- The linter reports it too, so an unparseable card is visible rather than silently counted as
  field-less (today it is invisible: it lints as a card that merely lacks fields).
- Check the index builder separately — an unparseable card currently enters the index with no
  fields, which is its own wrong answer, and may deserve exclusion rather than a blank record.

## Verification

- Seed a card with genuinely unparseable YAML (an unclosed quote, a tab-indented block) whose
  `column:` and `title:` ARE present in the text, run `fix`, and assert **no field was inserted**
  and a finding was reported naming the parse failure.
- Run `fix` a SECOND time on the same card and assert the file is byte-identical. That is the
  assertion that pins the unbounded half — a single-run test passes even with the duplication,
  because one inserted pair looks like a repair.
- Positive control: a card that genuinely LACKS `column:` still gets one inserted, so the fix is
  not "stop inserting fields".
- Neuter: restore the bare `catch { data = {} }` and confirm the two-run test reddens.

## Estimated risk

**MEDIUM to fix** — it changes a shared reader with 4+ call sites, which is exactly why the
review pass that found it deliberately skipped it as too wide for a mechanical fix round.
**HIGH to leave**: `trddgrep fix` is documented as a repair tool, so the corpus it corrupts is the
one nobody re-reads by hand.

## Provenance

Found by a `/code-review high --fix` pass on 2026-08-04 (finding #11 of 15 — the one it declined
to fix). Every claim above was re-verified first-hand against the current source before this card
was written; the reported line numbers had already shifted under the pass's other 14 fixes.

## Approval log

- 2026-08-04T19:35:33+0200 — MANDATE (self). Tier 0: a bugfix confined to this repo's own pillar
  tooling, no baseline deviation, no cross-team or release surface. No approval request was sent.

## Outcome — 2026-08-04T19:43

Landed as `8c0c459d`. `PillarDocument.parseError` carries the parser's own reason, propagated
through `ParsedTrdd` to `Card` — a FIELD rather than a throw, because `walkDocuments` streams the
whole corpus and one malformed card must not abort a sweep over the other 371.

**The tests forced out a half the plan did not contain.** The plan said "refuse to autofix"; the
first run of the new suite failed on a case I had written almost as an afterthought — the linter
was still emitting `COLUMN-MISSING` for the broken card. That is a FALSE finding (the column is
right there in the file), and it is the specific false finding that told `--fix` to insert a
duplicate. So the main rule loop skips such a card too: **a linter that misdiagnoses is worse than
one that abstains**, and reporting `UNPARSEABLE` *and* `COLUMN-MISSING` about the same card invites
exactly the repair that caused the damage.

`UNPARSEABLE` was also extended to the case it was NAMED for. It previously fired only when a
FILENAME carried no id; a YAML parse failure produced a perfectly ordinary `Card` with blank fields
and was never reported as unparseable at all.

**Three complementary neuters, each line-anchored, each reddening a distinct set:**

| neuter | tests red |
|---|---|
| the reader stops recording `parseError` | **4** — all of them; the whole feature rests on that one signal |
| the LINT loop stops skipping (`trdd-doctor.ts:509`) | **1** — exactly the "not reported as merely missing its fields" case |
| `fixCorpus` stops skipping (`trdd-doctor.ts:1118`) | **2** — the two-run case AND its positive control |

The two skip sites are anchored by LINE, not by pattern: an unanchored substitution matches both
`if (c.parseError) continue` sites at once and its result is unattributable. Same trap as
TRDD-YR4G2CZH's first neuter attempt, caught the same way — by reading `changed: 2+/2-` where
`1+/1-` was intended.

**The fixture's premise was verified before the fixture was written:** gray-matter really does
throw on an unclosed double-quoted scalar (`unexpected end of the stream within a double quoted
scalar`). A fixture that merely looked malformed but parsed fine would have made every assertion
in the file vacuous.

## Acceptance

- [x] `readDocument` can express "unparseable" distinctly from "no fields", without throwing —
      `PillarDocument.parseError`, propagated to `ParsedTrdd` and `Card`
- [x] `trdd-doctor --fix` refuses to autofix an unparseable document and reports it instead
- [x] the two-run byte-identical test exists, with the positive control and a recorded neuter —
      plus the occurrence-count assertions, so a future failure says WHY rather than only that the
      bytes differ
- [x] the linter surfaces an unparseable card as its own finding rather than as a field-less one —
      and, the part the tests added, STOPS surfacing it as a field-less one
- [x] the index builder's handling of an unparseable card is decided explicitly, not inherited —
      decision: **keep indexing it**, recorded in a comment at the site. The symmetric move (skip
      it) is wrong here for two measured reasons: absence from the index is how this builder
      signals DELETION, so skipping would make an unparseable card indistinguishable from a
      removed one and every sync would re-add and re-drop it; and the row it writes is not a lie
      in the way the linter's was — `col: ''` matches no column filter, so the card is INVISIBLE
      to board queries rather than misfiled into one, which is the honest answer for a column that
      cannot be read. Visibility to a human comes from `UNPARSEABLE` at severity error
