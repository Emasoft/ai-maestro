---
trdd-id: FKGMNGJB
title: A TRDD can carry a SECOND state field in its body and every gate passes it
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-30T06:27:51+0200
updated: 2026-07-30T07:04:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T06:27:51+0200
relevant-rules: [R25]
parent-trdd: L55IYKL4
derived: true
derived-kind: eht
blocked-by: []
npt: []
eht: []
labels: [pillar, linter, corpus-integrity, one-source-of-truth]
---

# A TRDD can carry a SECOND state field in its body and every gate passes it

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30T07:04

**The rule SHIPPED.** `BODY-STATE-CLAIM` is live in `lib/trdd-doctor.ts`, the `--fix` half is
implemented, 6 new guards pin it, 5 recorded neuters each redden a NAMED test, and the full
suite is green (276 files / 4133 tests, exit 0).

**NEXT ACTION — the ONE open item is a governance question, not code:** two of our own archived
cards carry a body claim the rule correctly reports, and **IND §12 forbids the remedy**
("Do not edit the body of a `complete` / `failed` / `superseded` / `published` / `live` TRDD").
§12 is the janitor's IND base, so reinterpreting it to authorise our own edit is the move the
cross-project rule forbids. Route the question to the janitor (precedent: janitor#103 for an
IND-base proposal) and get the USER's call; then repair the two cards and DELETE the gate
allowance, which is written to fail the moment they heal.

| card | zone · column | body claim | why it is blocked |
|---|---|---|---|
| `C7A81642` | archived · `complete` | `**Status:** Not started` | a TRUE contradiction — the exact incident shape, in our own corpus |
| `7123D51A` | archived · `completed` | `**Status:** Implemented 2026-04-20 (…)` | semantically agrees; unprovable by a tool (a date follows the verb) |

**Disposition of the 10 (measured, then acted on):**

| where | n | done |
|---|---|---|
| `design/tasks/`, all `column: todo` | 5 | **repaired** — the state word removed, the explanation KEPT under a label that names it (`**Deferred until:**`, `**Coverage:**`, `**Waiting on:**`, `**Scope:**`; one bare `Not started` carried no information and the line went). `updated:` deliberately NOT bumped — a hygiene repair must not manufacture recency (ai-maestro#96 L8). |
| `design/archived/`, terminal, AGREEING | 3 | reported as WARN, `--fix`-able, left alone under §12 |
| `design/archived/`, terminal, DISAGREEING | 2 | **blocked** — the table above |

**Load-bearing facts a re-reader needs:**

- **`bodyClaimAgreesWithColumn` is ONE predicate shared by the lint and the fixer.** The sibling
  rule shipped hours earlier with two copies and they had already diverged — the lint accepted
  only `VALID_COLUMNS`, the fixer also accepted `V1_STATUS_TO_COLUMN`, so `--fix` silently
  repaired a shape the lint never reported.
- **`done` is the ONE inflection accepted beyond the two vocabularies**, and only against a
  terminal column. Not a synonym guess: it is the past participle of the terminal set itself, and
  calling `**Status:** Done` on a `column: completed` card a CONTRADICTION is the tool
  misclassifying, not the tool being careful. Deliberately NOT `implemented` / `shipped` /
  `fixed`, which name an ACTION and can predate the column.
- **The claim regex matches a line-initial `Column:` — which is exactly a frontmatter field
  name.** Both entry points compute the frontmatter boundary themselves rather than trusting the
  caller; handed a whole file, an unguarded scan would flag every card in the corpus and the
  repair would DELETE `column:`. Neuter N5 proves it.
- **The live corpus does not exercise the fence/blockquote exclusion.** Every `**Status:**` this
  card quotes is prefixed (`…-9a8aba94-….md:19:**Status:** …`), so `^\s*` never matches — the
  seeded fixture is the only thing reaching that path, which is why it exists.

**SUPERSEDED — do NOT carry forward:**

- ~~"`V1_STATUS_TO_COLUMN` has only two keys, so `Done`/`Completed` can never map"~~ — it has
  **seven**. My probe printed only the two that need quoting in JS (`'not-started'`,
  `'in-progress'`) and hid the five bare ones, and I read the display artifact as the data.
- ~~"all 10 findings are ERROR, so the WARN branch is dead code"~~ — the split was **9 + 1** from
  the first run. `scripts/trdd-doctor.mjs` grouped by RULE alone and labelled the whole group
  `fs_[0].severity`, so the heading said ERROR ×10 over a mixed set. The summary line said
  `9 error` the entire time — two numbers on one screen disagreed and I read the wrong one.
  Fixed: the CLI now groups by (rule, severity) and counts `--fix`-ability instead of sampling
  row 0. The dangerous ordering was the mirror image — nine ERRORs under a WARN heading.

**The measurement that motivated it, machine-wide, 2026-07-30:**

| | |
|---|---|
| files carrying a body `**Status:**` line | **98**, across 13 corpora |
| …of those, in THIS repo | **10** (5 in `tasks/`, 5 in `archived/`) |
| …that CONTRADICT their own frontmatter | at least **4** say `column: complete` **and** `**Status:** Not started` |
| what `greptrdd validate` reports on this corpus | **0 errors** |

That last row is the finding. Our own corpus passes every gate while carrying ten cards with
a duplicate state field, because **no rule looks for one.**

## How this surfaced (worth keeping — the diagnosis took three wrong turns)

The janitor's `trdd-drift` reported three `ai-maestro-plugin` cards as
`status='not-started' but file untouched for 35d`. CORE filed **janitor#135** concluding the
detector *"read `status:`, found nothing, and defaulted the absence to `'not-started'`"* — a
fabricated value. I verified CORE's premise the same way CORE did (`grep '^status:'` → 0),
agreed, and **wrote it into a commit message and a TRDD.**

The USER relayed the janitor's pushback twice. On the second pass it supplied the grep that
settles it, whose third alternative neither #135 nor I had thought to include:

```
grep -nE '^column:|^status:|^\*\*Status:\*\*' TRDD-9a8aba94* TRDD-9e80e484* TRDD-9f10ed97*

  …-9a8aba94-….md:4:column: complete
  …-9a8aba94-….md:19:**Status:** Not started      ← real line, real value
```

**Nothing was fabricated.** Each card states its own state twice, in two spellings, and the
two disagree. The detector reads the prose one; its actual defect is PRECEDENCE, not
synthesis — a different and much smaller fix than #135 prescribes.

**Three transferable lessons, in the order I earned them:**

1. **A field can have a spelling your anchor misses.** `status:` / `column:` / `**Status:**`
   are three spellings of one concept. Two greps agreeing that a field is absent is not
   evidence of absence when a third spelling exists — enumerate the spellings first.
2. **When an instrument and my reading disagree, suspect the READING.** I told the USER a real
   finding was an artifact, twice, on the strength of a check whose scope I never questioned.
   The janitor was right both times.
3. **"0 errors" means "no rule looked".** A linter's silence is exactly as wide as its rule
   set. A clean verdict must be read as *clean of the classes it tests*.

## Why a body duplicate is as bad as the retired frontmatter field

`status:` was retired precisely because two state fields make every card ambiguous — the DEP
overlay says so outright (*"reusing it would make every legacy TRDD ambiguous"*). A body
`**Status:**` line defeats that identically: a reader (human, agent, or detector) has two
answers and no stated precedence, and the freshest-looking one is often the stale one. The
`column: complete` / `**Status:** Not started` pairs are that failure fully realised — the
card claims both terminal and unstarted.

There is a reason it happens, and it is not carelessness: the body line is a *v1-era header
convention* that the v1→v2 migration moved into frontmatter without deleting the original. So
this is migration residue, and it will keep being authored as long as old cards model it.

## What to build

1. **`BODY-STATE-CLAIM` in `lib/trdd-doctor.ts`** — scan the body (strictly AFTER the closing
   `---`; the frontmatter boundary must be computed, never assumed, or the rule flags its own
   frontmatter) for `**Status:**` / `**Column:**` / a line-initial `Status:`.
   - **ERROR** when the claim disagrees with frontmatter `column:` — two answers, one card.
   - **WARN** when it agrees — harmless today, a second source of truth tomorrow.
2. **`yarn trdd:fix` support**, and this one is genuinely mechanical only in the agreeing
   case: delete the redundant line. **A DISAGREEING pair must never be auto-resolved** — which
   claim is true is a judgment (the 4 `complete`/`Not started` cards could be either), and
   picking one silently is how a tool loses work. Report it, leave it.
   **Do not bump `updated:`** on a mechanical repair (ai-maestro#96 L8).
3. **The same check in the write gate** (`TRDD-SCMPWF6R`, sibling) so a NEW card cannot
   introduce one. Lint catches the 98 already there; the gate stops the 99th.
4. **Then the 10 in this repo**, by hand, per card — they are ours and 5 are in `archived/`,
   where §12's terminal-freeze applies, so removing a body line there needs the freeze
   question answered first (it is metadata hygiene, not a body edit of substance — but say so
   deliberately rather than assuming).

## Explicitly NOT in scope

- **The other 88 files.** Other user-owned projects: **issue or fork-PR, never a direct
  edit.** Once the rule ships, each repo's own Claude can run `trdd:doctor` in its own repo.
- **Correcting janitor#135.** Owed — I amplified its wrong diagnosis in a commit — but it is a
  comment on their issue, tracked separately, not code here.
- **`COLUMN-MISSING` × 158 and `ZONE-MISMATCH` × 270.** The other two big classes from the
  same sweep. The first is `trdd:fix` territory per-repo; the second is blocked on
  `ai-maestro#93`.

## Acceptance

- [x] `BODY-STATE-CLAIM` ERRORs on a seeded card whose body claim contradicts `column:`, and
      WARNs on one that agrees — two fixtures, not one
- [x] the rule computes the frontmatter boundary and does NOT flag a frontmatter `status:`
      (a frontmatter `status:` holding a column value is `STATUS-HOLDS-COLUMN-VALUE`'s job —
      two rules, two messages, no overlap; and note per the USER's 2026-07-30 ruling that a
      frontmatter `status:` carrying a NON-column value is legitimate and neither rule fires)
      — pinned with a positive control asserting the SIBLING rule did fire, so the absence
      assertion cannot pass on a fixture that never parsed
- [x] it does NOT flag a `**Status:**` inside a fenced code block or a quoted example (this
      very card contains three; if the rule flags its own TRDD the rule is wrong)
- [x] run against the live corpus it finds exactly our 10, listed by path — 10 found
      (7 ERROR + 3 WARN after the `done` inflection), dispositions in the STATE table
- [x] `trdd:fix` removes an AGREEING duplicate and REFUSES a disagreeing one, leaving the file
      byte-identical in the refusal case
- [x] a recorded **neuter run** per guard (break it, watch the NAMED test fail; read the test
      COUNT, never the exit code) — 5 neuters, each reddening a named test, and each
      behavioural test falling to exactly one:
      N1 severity split → WARN test + gate · N2 fence/quote skip → fenced test only ·
      N3 rule presence → ERROR + WARN + gate · N4 fixer's agreement gate → refusal test only ·
      N5 fixer's frontmatter boundary → repair test only
- [x] full suite green — 276 files / 4133 passed / 2 skipped, exit 0
- [ ] **OPEN (governance):** route the §12 question for `C7A81642` + `7123D51A` to the janitor
      and the USER, repair the two cards, then DELETE the gate allowance in
      `tests/unit/trdd-doctor.test.ts` (it asserts the count EXACTLY, so it fails the moment
      they heal — an allowance that tolerates its own healing is how a known-issue list
      outlives the issue and starts hiding new ones)

## Notes and lessons learned

- The three lessons above are recorded in the body deliberately rather than only here, because
  they are about the diagnosis and a future reader needs them before the fix.
- A rule that scans bodies for a pattern will match its OWN documentation. This card quotes
  `**Status:**` three times; a naive implementation would flag the card that specifies it.
  That is the acceptance box above, and it is the same self-match trap as a source scanner
  flagging its own pattern table.

## Approval log

- 2026-07-30T06:27:51+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Tier 0: this project's own linter, in-scope, reversible, no cross-team or release surface.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
