---
trdd-id: LS9N71DX
title: CLAUDE.md carries two wikimem indexes over the same corpus
column: complete
created: 2026-09-04T17:23:18+0200
updated: 2026-09-04T19:05:29+0200
implementation-commits: [164aad16, 214199d6, ca54e352]
current-owner: claude-opus-session
created-by: user
assignee: claude-opus-session
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: user
approval-datetime: 2026-09-04T17:23:18+0200
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

**DECIDED: the janitor's block is KEPT; this repo's `scripts/wikimem-index.mjs` loses its
CLAUDE.md write path.** The decision was made on measurement, not preference — both greps the
acceptance list demanded are done, and one of them settled it outright.

- **Nothing pins the project generator.** Repo-wide grep for `wikimem-index` found no CI
  workflow, no test, no `package.json` script — every hit is prose (docs, TRDDs, reports) or the
  generated fence markers themselves. Its documented `--check` mode is invoked by nobody, so
  retiring the CLAUDE.md write path breaks no gate.
- **The hand-run block was the stale half — measured.** Writing the generator's current output
  to a scratch copy of CLAUDE.md and diffing it against the committed block showed **3 entries
  already out of date**. The janitor's block, written by its own hook, cannot fall behind the
  same way.
- **A SEPARATE finding, which an earlier draft of this block filed under the one above —
  wrongly.** `node scripts/wikimem-index.mjs --check` exited **1**, naming two pages
  (`agent-isolation-is-not-enforced`, `never-log-a-security-argv`) carrying no
  `metadata.topic:`. That is a **content defect in two memory pages**, not staleness in
  CLAUDE.md, and its fix is to add the topics — not to delete an index. Both point the same
  way, so the decision is unaffected, but they are different facts and stacking them under one
  heading inflates the evidence for the decision. **Now fixed** (`topic: security-and-auth` on
  both, written through `memgrep update-mem-topic`); `--check` exits **0** again.
- **Only one of the two write paths is mine to retire.** The janitor's runs from a plugin hook in
  another project (cross-project rule: file an issue, never edit). This repo's script is entirely
  local and manual. Keeping the block that maintains itself and dropping the one that needs a
  human to remember is the only version of this fix I can actually complete.

**What is deliberately NOT changed:** `--check` and the `--write .claude/project/memory/ai-maestro-overview.md`
target both stay. The script keeps its other two jobs; only `CLAUDE.md` is refused.

**`metadata.topic:` is NOT orphaned by this change.** The surviving overview target still builds
a topic-grouped index from exactly that field, so `--check` remains a live gate over live data
rather than a vestige.

**Supersession recorded here because the other card is frozen.** `TRDD-5TELESBL` (archived,
`complete`) fixed five topic-less pages, and its stated rationale is CLAUDE.md-specific —
*"A page with no topic never appears in it"*, citing `--write CLAUDE.md`. That sentence is now
half-false: the mechanism survives, but through the overview page, not CLAUDE.md. Terminal
cards are frozen (IND base step 12), so the correction lives on this card. Its acceptance had
also **regressed** — it closed at `--check` exit 0 and had drifted back to exit 1 with two
*different* pages, tracked by nothing. Restored to exit 0 in this card's work.

Concretely, so a future reader is not ambushed: **5TELESBL's verification step 3 is
`node scripts/wikimem-index.mjs --write CLAUDE.md --write .claude/project/memory/ai-maestro-overview.md`,
and half of that command now exits 1 by design.** Run it as written and you get a refusal citing
a TRDD id you then have to go find. Drop the `--write CLAUDE.md` half; the rest still works and
still does 5TELESBL's job. Its fix now serves one consumer instead of two — it was not
invalidated.

**The cost, priced properly on the third pass — and the reasoning above was thinner than it
looked.** The janitor's block groups by `tier: hub` + wikilinks, so the 11 named
`metadata.topic:` sections are gone. Two facts I had on screen and never connected:

- **This corpus has exactly TWO non-overview hubs** (`amp-messaging`,
  `password-and-credential-system`) — my own probe printed that line, and I used it only to pick
  a mutation target. So the replacement is 2 small groups plus ~60 entries under `**Other
  topics**`. With 2 hubs the grouping is *structurally incapable* of being an index; it
  degenerates to a flat list by construction, and gets worse as pages are added.
- **`claudemd_slim` cannot read `metadata.topic:` at all.** `PageInfo` carries
  `name, filename, description, tier, lmd, wikilinks`; `topic` appears in that module only in a
  docstring, a comment, and the `**Other topics**` heading string. So "let the janitor group by
  topic" is a `scan_pages` change too, not just a rendering one.

**RETRACTED: "recall runs through `memgrep`, not through reading this file."** That argument
proves too much — it argues no index belongs in CLAUDE.md at all, and I used it to justify
keeping the worse one. The index serves the case `recall` cannot: an agent that does not yet
have a symptom, browsing what areas exist. That is a pushed surface, and CLAUDE.md is the only
one this project has.

**What survives the correction, and why the decision still stands:** only one of the two write
paths was mine to retire, so the alternative parks the duplicate cost on another repo's
schedule; the local block was measurably stale; and every page still carries its one-line
symptom either way, which is most of what an agent string-matching a list needs. The call is
probably right. It was not *reasoned* as the three-way choice it actually was, and that is the
finding.

**Acted on rather than noted:** `Emasoft/ai-maestro-janitor#299` asks the janitor to group by
`metadata.topic:` when present and fall back to hubs when absent. That was previously written
here as a fallback *if the grouping is missed*; a review pointed out it was the dominating option
all along, so it is filed now rather than held.

`todo` → `ai_review` skips five columns: legal here because only the IND base binds an external
session, and it mandates a column vocabulary, not a sequential walk.

**Left for whoever writes the next lesson, recorded here because this card is its last editable
moment.** `.claude/rules/lessons-verification.md` is at **97538 of its 98304-byte cap — 766 bytes,
roughly one and a half entries.** The next author hits the cap mid-commit. The mechanism already
exists and needs no design: the file's own header says an entry that outgrows the budget is
**MOVED VERBATIM** to `.claude/rules-reference/lessons-verification-full.md`, under the same
heading. Relocation, never deletion — do not go hunting for an entry "superseded by" newer work
to retire, which is the judgement that gets made too eagerly.

**NEXT ACTION.** None here. The topic grouping is now janitor#299's to restore — not this
repo's, and never by reviving the second generator. #299 is deliberately NOT a `blocked-by:` or
an EHT: that field takes TRDD-id citations, not issue URLs, and an EHT would gate this card's
`complete` on another repo's schedule forever. The retirement is complete and correct without
it; the grouping is a follow-up improvement, not a hole this change opened.

## Problem

`CLAUDE.md` (311 lines) carries **two separate fenced index blocks** over the
same PROJECT-scope memory corpus (`.claude/project/memory/`):

- lines 135-229: fences `<!-- WIKIMEM-INDEX-START -->` / `<!-- WIKIMEM-INDEX-END -->`,
  written by this repo's own `scripts/wikimem-index.mjs`.
- lines 231-311: fences
  `<+-+-JANITOR-WIKIMEM-INDEX-START-(do-not-modify)-+-+>` /
  `<+-+-JANITOR-WIKIMEM-INDEX-END-(do-not-modify)-+-+>`, written by the
  ai-maestro-janitor plugin's `scripts/lib/repomap/claudemd_slim.py`.

Neither generator is aware of the other's fences, so both blocks are
maintained independently and both duplicate roughly the same ~176 lines of
topic index over the same pages.

## Root cause

CLAUDE.md's own header states the file is deliberately kept small because its
cost is `bytes x turns x sessions` — it rides the cached prefix of every turn
of every session. Two index blocks over one corpus double that fixed cost for
no added coverage: the same pages are indexed twice, once per generator.

This was committed as-is in `d265ed63` rather than resolved, deliberately —
the two generators were never reconciled at that time.

## Proposed fix

Decide **which generator owns the index** (`scripts/wikimem-index.mjs` or the
janitor's `claudemd_slim.py`), keep exactly one block, and **retire the
losing generator's write path in the same change** — not just delete its
output once. Whichever block is dropped, if its generator still runs (project
script via manual `node scripts/wikimem-index.mjs --write CLAUDE.md`, or the
janitor's SessionStart/PostCompact hook), it will regenerate the block it
used to own and the duplication returns. This is the same
"persistent-state-shaped-by-the-caller-oscillates" pattern already recorded
in this project's memory — do not resolve this TRDD without addressing that
oscillation risk directly (retire the write path, not just today's output).

Do NOT treat the janitor block's shorter per-entry descriptions as a defect:
`_short_desc` in `claudemd_slim.py` is documented (its own docstring) as a
picker aid — the full `description:` in each memory page's frontmatter
remains the recall surface `memgrep` actually ranks on.

## Verification

- After the fix, `CLAUDE.md` contains exactly one fenced wikimem index block.
- Re-running whichever generator remains regenerates that one block
  idempotently (no diff on a second run with no memory changes).
- Re-running (or triggering) the retired generator does NOT reintroduce its
  old block — confirms its write path was actually retired, not just its
  current output deleted.

## Estimated risk

LOW — this is a documentation/tooling consolidation, not a runtime code
change. Main risk is silently breaking a CI check or doc-sync test that pins
one of the two blocks by name/fence; the acceptance checklist below covers
that before anything is removed.

## Acceptance

- [x] Grep the whole repo for every consumer of `scripts/wikimem-index.mjs`
      (tests, CI workflows, `package.json` scripts, docs, README, other
      TRDDs) BEFORE removing anything — the script documents a `--check`
      mode that may be pinned by a gate. **No gate pins it.** Every hit of a
      repo-wide grep for `wikimem-index` is prose (docs / TRDDs /
      `reports_dev`) or a generated fence marker. **That grep alone was not
      enough** — it passed `--exclude-dir=.git`, so a `.git/hooks/` gate was
      never searched, and this repo demonstrably runs a pre-commit hook. Three
      direct checks close it: `.github/` → no hit, `.git/hooks/` → no hit,
      `package.json` → no hit. **And a free argument settles it without any
      grep at all:** `--check` was exiting **1** all day today and every commit
      in this session succeeded, so nothing in the commit path can have been
      gating on it. A wrapper invoking the script through a variable is the one
      shape none of this would catch. What makes the residual gap tolerable is
      the guard's failure mode rather than the grep: it exits 1 instead of
      skipping silently, so a missed invoker fails loudly on first run rather
      than quietly reintroducing the block.
- [x] Grep the whole repo (and the janitor plugin cache, if reachable) for
      every trigger of `claudemd_slim.py` (SessionStart hook, PostCompact
      hook, any script/cron invoking it) before removing anything. **Found,
      in the 3.4.14 cache:** `scripts/claudemd_slim.py` (the CLI entry),
      `lib/claudemd_queue.py` (the queue whose advisory reads *"CLAUDE.md
      wikimem index is stale — queued, will drain on next compaction"*),
      `lib/claudemd_migration_{plan,apply}.py`, and the
      `detectors/project-map-drift.py` detector. It is hook-driven and it
      fired during this session's own compaction, logging *"claudemd-slim:
      wrote wikimem index (69 pages)"* — i.e. the block that is being kept
      maintains itself with no human in the loop.
- [x] Decide and record which generator is kept and which is retired.
      **KEPT: the janitor's `claudemd_slim.py` block. RETIRED: this repo's
      `scripts/wikimem-index.mjs` → CLAUDE.md write path** (the script keeps
      `--check` and its overview-page target). Rationale and the measurement
      it rests on are in the STATE block above.
- [x] Retire the losing generator's WRITE PATH to CLAUDE.md (not merely its
      current output) so the oscillation cannot recur. **`parseArgs` now
      refuses any `--write` target whose `basename` is `CLAUDE.md` and exits
      1** (`164aad16`). Driven, not assumed: `node scripts/wikimem-index.mjs
      --write CLAUDE.md` prints the refusal, exits **1**, and leaves the file
      unmodified. `--check` and `--write .claude/project/memory/ai-maestro-overview.md`
      both still run — the overview refresh in that same commit (3 entries) is
      the positive control that the surviving path was not collaterally broken.
- [x] Confirm CLAUDE.md ends with exactly one wikimem index block after the
      change. **`grep -c -- "<!-- WIKIMEM-INDEX-" CLAUDE.md` → 0** (the
      project's fences) and **`grep -c "JANITOR-WIKIMEM-INDEX-" CLAUDE.md` → 2**
      (the janitor's start + end). 311 → **215 lines**. Note the needle:
      a bare `WIKIMEM-INDEX-START` returns **1**, because it is a SUBSTRING of
      `JANITOR-WIKIMEM-INDEX-START` — a check written that way reads as
      "one block left" whether the project block is present or gone, so it
      cannot distinguish the fixed state from the broken one. The two greps
      above discriminate.
- [x] Confirm the kept generator's output is idempotent (no diff on a
      no-op re-run). Checked against the module itself, both directions:
      `index_is_stale(CLAUDE.md, scan_pages(memdir))` → **False**, and the
      freshly rendered body is **byte-identical** to the committed one
      (10294 B each). Caveat: this holds for the BODY, not the header digest,
      which over- and under-fires — `Emasoft/ai-maestro-janitor#298`.

## Approval log

- 2026-09-04T17:23:18+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-04T19:05:29+0200 — COMPLETED by claude-opus-session. All six boxes driven, not asserted. Four adversarial reviews; the first three each found real defects (a wrong mechanism claim in a commit body, a bug in the fix proposed on janitor#298, a coverage finding filed under a staleness heading, an unverified zone/column claim, a missing assignee, a mispriced three-way decision), and the fourth returned "the card is done, stop reviewing it" — which is the signal that stopped the review ratchet rather than a fifth round.
