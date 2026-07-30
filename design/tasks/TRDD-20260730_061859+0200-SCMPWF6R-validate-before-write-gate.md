---
trdd-id: SCMPWF6R
title: The pillar write seam accepts any value — validate BEFORE write, so corruption is impossible not merely detectable
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-30T06:18:59+0200
updated: 2026-07-30T06:37:50+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T06:18:59+0200
relevant-rules: [R25]
parent-trdd: L55IYKL4
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
labels: [pillar, write-gate, corpus-integrity]
---

# The pillar write seam accepts any value

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

> **SUPERSEDED — do NOT carry forward:** earlier revisions of this block said *"nothing is
> corrupted today, the census is clean"* and *"the detector invented the value"*. **Both are
> false.** Four measurement errors, all mine, all recorded below because they are the more
> useful half of this card. The real numbers: **622 ERRORs across 32 of 37 corpora**, plus
> **98 files carrying a duplicate body-level `**Status:**` state field** — a class the linter
> has NO rule for, so `ai-maestro`'s own "0 errors" hid 10 of them.

**The corpus-wide truth (`greptrdd validate --design-dir` per corpus, 2026-07-30):**

```
270 ZONE-MISMATCH          158 COLUMN-MISSING      92 TITLE-MISSING
 66 STATUS-HOLDS-COLUMN-VALUE (was RETIRED-STATUS-FIELD)     8 DERIVED-FLAG-MISSING  7 GRAPH-CHILD-MISSING
  6 GRAPH-FALSE-COMPLETE     4 ORDER-NPT-VIOLATED    4 GRAPH-UNKNOWN-BLOCKER
  3 GRAPH-TWO-PARENTS        1 each: GRAPH-ORDER-CYCLE · GRAPH-CYCLE ·
                                    GRAPH-DANGLING-BLOCKER · DANGLING-REF
```

**`COLUMN-MISSING` × 158 is the USER's complaint in its true form:** agents wrote TRDDs
with **no `column:` field at all**. That is precisely the shape a pre-write gate refuses,
and precisely what makes a downstream detector synthesize a default. The specific string
`not-started` was wrong; the instinct behind the report was right.

**NEXT ACTION:** add the validate-before-write gate to `editTrdd` in `lib/trdd-store.ts:270`
— reject any field whose value violates the corpus grammar, BEFORE `fs.writeFileSync`.
Every write path in the system funnels through that one function, so one gate covers all
of them.

**The gate must refuse, not warn.** A warning on a write path is a detector, and we
already have two of those (`greptrdd validate`, `trdd:doctor`) — both after the fact,
neither in CI or a git hook.

## How I got the measurement wrong four times

Recorded first because it is the transferable part, and because both errors are ones this
repo's own lessons file already warns about.

**Error 1 — the glob was one level too shallow.** I swept `~/Code/*/design` and reported
*"0 occurrences anywhere on this machine"*. The fleet's plugin repos are nested TWO deep
(`~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/design`), so the three files the janitor named
were never in scope. A search whose depth does not match the layout returns 0 and reads as
*absent* — indistinguishable from a real negative. The fix is `find … -type d -name tasks
-path "*/design/*"`, which discovers the corpora instead of assuming their shape: **37 of
them, not the ~12 my glob could see.**

**Error 2 — I hand-rolled grep when a tool already encoded the grammar.** The USER asked
*"aren't you using trddgrep?"* and the answer was no. `greptrdd validate --design-dir`
per corpus found **622 ERRORs in 13 distinct classes**; my census had counted `column:`
values and would never have found ZONE-MISMATCH, COLUMN-MISSING, TITLE-MISSING, or any
graph defect, because I never thought to look for them. A hand-rolled check tests the
hypothesis you already have; the linter tests the grammar.

Both errors point the same way: **the tool is the instrument, and my grep was a worse copy
of it.** That is also the argument for this card — the same grammar that catches these
after the fact should refuse them at write time.

## The USER's report, and the correction it needs

> *"apparently some agents updated or created TRDDs with a non existent 'non-started'
> column"*

**Half right, and the half that is wrong matters.** Measured 2026-07-30 across all 37
corpora:

- **`column: not-started` — 0 occurrences.** Nothing ever wrote an invalid column *value*.
- **`status: not-started` (frontmatter) — 10 occurrences**, always the RETIRED v1 field, in 3
  repos (`claude-plugins-validation` 5, `claude-acct-switcher` 4, `llm-externalizer-plugin` 1).
- **`**Status:** Not started` (BODY, bold markdown) — this is the one that matters, and it is
  where the value actually lives.

### Error 3 — I repeated CORE's diagnosis without checking the body, and it is WRONG

CORE's #135 says:

> *"The detector appears to read `status:`, find nothing, and **default the absence to
> `'not-started'`**. A missing field is being reported as a concrete value."*

**There is no defaulting. The value is in the file.** The janitor pushed back twice and
supplied the grep that settles it — note the third alternative, which neither #135 nor I had
looked for:

```
grep -nE '^column:|^status:|^\*\*Status:\*\*' TRDD-9a8aba94* TRDD-9e80e484* TRDD-9f10ed97*

  …-9a8aba94-….md:4:column: complete
  …-9a8aba94-….md:19:**Status:** Not started      ← the detector reads THIS
  …-9e80e484-….md:4:column: complete
  …-9e80e484-….md:19:**Status:** Not started
  …-9f10ed97-….md:4:column: complete
  …-9f10ed97-….md:19:**Status:** Not started
```

Each card carries **two state fields that contradict each other**: frontmatter
`column: complete`, body `**Status:** Not started`. #135's own disproof — `grep -l '^status:'`
→ 0 — could not see it, because it anchored on the frontmatter spelling. I ran the same
frontmatter-only check, reached the same wrong conclusion, and **committed it** (`SCMPWF6R`'s
first revision and its commit message both assert the synthesis). Retracted here.

**The detector's real flaw is PRECEDENCE, not synthesis** — it prefers the prose line over
frontmatter `column:`. A far smaller and different fix than "stop defaulting", and #135
should be corrected rather than implemented as written.

**The lesson is the one this repo keeps re-learning:** when an instrument and my reading
disagree, suspect the READING. Twice in one hour I told the USER a real finding was an
artifact, on the strength of a check whose scope I had not questioned.

### Error 4 — this repo is NOT clean either

`greptrdd validate` reports 0 errors on `ai-maestro`, and **10 of the 98 files carrying a
body `**Status:**` line are ours.** Machine-wide: 98 files across 13 corpora, of which **4
say `column: complete` and `**Status:** Not started` in the same file.** So the linter has a
real blind spot — no rule detects a body-level state claim, let alone one contradicting the
frontmatter — and "0 errors" meant "no rule looked".

That blind spot is the second piece of work this turn found, and it is MINE, in MY repo: a
`BODY-STATE-CLAIM` rule for `lib/trdd-doctor.ts`. One source of truth is the entire reason
`status:` was retired; a duplicate in the body defeats it just as thoroughly as a duplicate
in the frontmatter, and today nothing says so.

- **`COLUMN-MISSING` × 158** remains the other real corruption: no state field at all.

### Error 5 — my own linter asserted the same false premise, and its autofix DESTROYED data

**USER ruling 2026-07-30: `status:` is NOT a duplicate of `column:` — it carries a different
aspect, by requirement.** The pillar specs prove it in this very repo: `design/specs/*.md`
each carry `status: normative`. What v1 kept in `status:` was the PIPELINE STATE, and v2 moved
*that one aspect* to `column:`. Measured: of 66 `status:` values in TRDD zones machine-wide,
all 66 are pipeline states (`completed` 41, `not-started` 10, `in-progress` 10, `superseded` 3,
`proposal` 1, `blocked` 1) — so the residue is real, and the field is still legitimate.

`lib/trdd-doctor.ts` keyed its rule on `fmHas('status')` — the FIELD NAME — called it
"retired", and marked it **`autofixable: true`**. So `yarn trdd:fix`:

- with a column present → **deleted the `status:` line whatever it held**;
- with no column → **rewrote `status: X` into `column: <mapped>`**, `?? 'todo'` swallowing every
  unrecognised value. Worse than a delete: a field converted into a different field with an
  invented value, the original unrecoverable, the card asserting a state nobody chose.

Fixed to `STATUS-HOLDS-COLUMN-VALUE`, keyed on `isPipelineStateValue(value)` — **ONE exported
predicate the linter and `fixCorpus` now share**, because they had already drifted: the lint
checked only `VALID_COLUMNS` while the fixer also accepted the v1 map, so it repaired a shape
it never reported. That is the worst asymmetry a fix pipeline can have, since the report is all
a human reviews before running `--fix`. Complementary neuters: `→ false` reddens 4 tests,
`→ true` reddens 2, each on its own guard.

**The USER's `column: todo` fallback is preserved and now GUARDED.** It is a deliberate
requirement — force the agent to evaluate the task — but *only* for a genuinely missing column,
never licence to repurpose another field. The condition became
`!c.column && !statusIsPipelineState` (the complement of branch (b), or a card falls through
both and stays column-less forever), and the test asserts BOTH halves: the column is added
**and** the `status:` survives.

## But the structural point is right, and it is confirmed at the seam

The USER's actual argument survives intact — indeed the 622 errors are its proof: *nothing
stops it*. Read first-hand, 2026-07-30:

| claim | verified |
|---|---|
| `greptrdd` has edit verbs | **NO.** Its whole surface is read: board/next/why/unblocks/roots/show/search + lint/validate/index-verify. The only write it names is `yarn trdd:fix` (mechanical repair of derivable findings). |
| a rule/skill mandates a tool for TRDD writes | **NO.** Zero mentions of `greptrdd` in `rules/aimaestro/*.md` or the IND base. There IS an intended write path (`aimaestro-trdd.sh` + the `ama-trdd-server` skill), but no rule says *never hand-edit*, and per CLAUDE.md its write verbs 403 for an agent caller. |
| the write path validates before writing | **NO — this is the gap.** |
| `prrdgrep` / `specsgrep` exist | **NO.** Neither does `design/requirements/PRRD.md`. Phase 3 of the active plan, blocked on NPT N1. |

**The seam, exactly:**

- `app/api/trdd/[id]/route.ts:69-77` validates only that each value **is a string** — and
  says why: *"the line-based writer emits `field: value` verbatim, so a non-string would
  corrupt the grep-first format."* Type, not grammar.
- `lib/trdd-store.ts:270-286` — `editTrdd` — loops `setFrontmatterField(content, k, v)` over
  an arbitrary `Record<string,string>` and calls `fs.writeFileSync`. **No enum check, no
  lint, no id resolution.**

So `aimaestro-trdd.sh edit <id> --set column=not-started` **succeeds**, and the value is
caught only later, by a detector nothing runs automatically. The USER's memgrep analogy is
the right one: memgrep's editorial ops are transaction-gated, so an invalid write cannot
land in the first place.

## What to build

**One gate, at the one seam.** `editTrdd` is the single funnel — the API route, the CLI,
and every lifecycle verb (`promote`/`refuse`/`archive`) go through it or its siblings in the
same file. Validating there means no caller can bypass it, which is the whole reason not to
put the check in the route.

1. **Field grammar, refusing on violation** (reuse the doctor's existing rule set — do not
   author a second vocabulary, that is how two sources of truth start):
   - `column` ∈ the ratified 17 + the folder-lifecycle overlay values
   - `blocked-by` non-empty ⟺ `column: blocked`
   - a referenced `TRDD-<id8>` must RESOLVE (`blocked-by`, `npt`, `eht`, `parent-trdd`,
     `supersedes`, `superseded-by`) — the USER's *"and reference existing TRDDs"*
   - `min-approval-requirement` ∈ the authority ladder; `mandate: true` ⇒
     `authority(mandated-by) >= authority(min-approval-requirement)`
   - dates parse as ISO 8601 with an offset, and `updated` is never in the FUTURE
   - terminal columns are frozen (§12) — refuse a body edit on `complete`/`published`/`live`
2. **Return the finding, not a boolean.** The refusal must name the field, the value, and
   the legal set, so an agent's next attempt is correct rather than a guess.
3. **Same gate for the two missing pillars** when Phase 3 lands — `prrdgrep`/`specsgrep`
   inherit it from `lib/pillar/store.ts`, they do not re-implement it.
4. **THEN mandate the tool in the rules.** A rule that says *"never hand-edit, use the
   tool"* is worth writing only once the tool can actually refuse a bad write. Ordered this
   way deliberately: mandating a tool whose validation is a no-op buys nothing and costs
   every agent a round-trip.

## Explicitly NOT in scope

- **Repairing the 32 dirty corpora.** They are OTHER user-owned projects, so the
  cross-project rule binds: **issue or fork-PR, never a direct edit.** The gate stops the
  BLEEDING; the migration is a separate card per repo, and most of it (`COLUMN-MISSING`,
  `STATUS-HOLDS-COLUMN-VALUE`) is mechanically decodable by `yarn trdd:fix` run IN that repo
  by ITS own Claude. **Do not bump `updated:` during a mechanical repair** — a tool must not
  manufacture recency (ai-maestro#96 L8). Note this is only safe AFTER Error 5's fix: before
  it, `trdd:fix` would have destroyed a legitimate `status:` in every one of those repos.
- **The 270 ZONE-MISMATCH.** Blocked on `ai-maestro#93` (the unruled archival vocabulary,
  board task #88). Fixing the parked cards before that ruling would pick the vocabulary by
  accident.
- **The janitor's `trdd-drift` PRECEDENCE bug** (it prefers the body `**Status:**` line over
  frontmatter `column:`). Their side — but janitor#135 as written prescribes the WRONG fix
  ("stop defaulting"), and I endorsed that diagnosis in a commit message, so correcting the
  record there is owed. Their detector was right about the file all along.
- **The `BODY-STATE-CLAIM` doctor rule.** Its own sibling card — same parent, empty
  `npt:`/`eht:` per depth-1 — because it is a LINT rule (post-hoc, whole-corpus) while this
  card is a WRITE gate (pre-hoc, one file). Different surfaces, different acceptance.
- **Making `aimaestro-trdd.sh`'s write verbs reachable by an agent** (they 403 today). A
  separate authorization question; do not smuggle it in here.
- **Wiring `greptrdd validate` into CI or a git hook.** Complementary, cheap, and a
  different card — a post-hoc gate and a pre-write gate solve different halves.

## Acceptance

- [ ] `editTrdd` refuses an out-of-vocabulary `column` with a message naming the legal set,
      and the file on disk is **byte-identical** afterwards (a refusal that half-writes is
      worse than no gate)
- [ ] a write that would leave `column:` ABSENT is refused — the 158-instance class, and the
      one a value-checking gate would still let through
- [ ] a dangling `blocked-by: [TRDD-XXXXXXXX]` is refused; a resolvable one is accepted
- [ ] the grammar is READ from the doctor's existing rules, not re-authored — proven by
      deleting a rule from the doctor and watching the gate stop refusing that shape
- [ ] every guard carries a recorded **neuter run** (break it, watch the NAMED test fail;
      read the test COUNT, never the exit code)
- [ ] the full suite is green, and `greptrdd validate` on THIS corpus still exits 0
- [ ] the rule mandating the tool is written LAST, after the gate demonstrably refuses

## Notes and lessons learned

- **A search whose glob depth does not match the layout returns 0 and reads as ABSENT.**
  `~/Code/*/design` missed every fleet plugin repo (they nest two deep), so I reported
  "0 occurrences on this machine" about files the janitor could name. DISCOVER the corpora
  (`find -type d -name tasks -path "*/design/*"` → **37**, not the ~12 the glob saw) instead
  of assuming their shape.
- **When a linter for the grammar exists, hand-rolled grep is a worse copy of it.** My
  census counted `column:` values; `greptrdd validate` found **622 ERRORs in 13 classes** I
  never thought to look for — including the 158 cards with no `column:` at all. A hand-rolled
  check tests the hypothesis you already hold; the linter tests the grammar.
- **A field can have a SECOND spelling nobody's grep anchors on.** `status:` (frontmatter),
  `column:` (frontmatter) and `**Status:**` (bold body prose) are three spellings of one
  concept. CORE's #135 checked the first two, concluded the value was fabricated, and filed a
  fix for a bug that does not exist; I re-ran the same two anchors and endorsed it in a
  commit. The value was on line 19 of every file. **Enumerate the spellings before declaring
  a field absent** — and when the report and your check disagree twice, the check is the
  suspect.
- **"0 errors" means "no rule looked".** `greptrdd validate` passes this corpus while 10 of
  our own cards carry a duplicate body state field. A linter's silence is only as wide as its
  rule set, so a clean verdict must be read as *clean of the classes it tests*, never as
  clean.
- A grep for `^column:` matches the BODY too. Chasing this, I flagged
  `~/Code/ANIME2SVG/…-3ZAF2O2I-…md:53` as a prose-valued column; the frontmatter closes at
  line 15 and the real value is `planned`. My own lessons file already carries this trap,
  and I walked into it anyway — one `awk` for the closing `---` settles it.

## Approval log

- 2026-07-30T06:18:59+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Tier 0: this project's own source, in-scope, reversible, no cross-team or release surface.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
