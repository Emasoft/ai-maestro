---
trdd-id: FKGMNGJB
title: A TRDD can carry a SECOND state field in its body and every gate passes it
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-30T06:27:51+0200
updated: 2026-07-30T06:27:51+0200
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

**NEXT ACTION:** add a `BODY-STATE-CLAIM` rule to `lib/trdd-doctor.ts` — ERROR when a card's
body carries a state claim (`**Status:**`, `**Column:**`, `Status:` at line start) and it
DISAGREES with frontmatter `column:`; WARN when it agrees (still a duplicate source of truth).

**The measurement that motivates it, machine-wide, 2026-07-30:**

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

- [ ] `BODY-STATE-CLAIM` ERRORs on a seeded card whose body claim contradicts `column:`, and
      WARNs on one that agrees — two fixtures, not one
- [ ] the rule computes the frontmatter boundary and does NOT flag a frontmatter `status:`
      (that is `RETIRED-STATUS-FIELD`'s job — two rules, two messages, no overlap)
- [ ] it does NOT flag a `**Status:**` inside a fenced code block or a quoted example (this
      very card contains three; if the rule flags its own TRDD the rule is wrong)
- [ ] run against the live corpus it finds exactly our 10, listed by path
- [ ] `trdd:fix` removes an AGREEING duplicate and REFUSES a disagreeing one, leaving the file
      byte-identical in the refusal case
- [ ] a recorded **neuter run** per guard (break it, watch the NAMED test fail; read the test
      COUNT, never the exit code)
- [ ] full suite green

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
