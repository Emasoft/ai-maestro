---
trdd-id: LS9N71DX
title: CLAUDE.md carries two wikimem indexes over the same corpus
column: ai_review
created: 2026-09-04T17:23:18+0200
updated: 2026-09-04T18:57:14+0200
implementation-commits: [164aad16]
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

**`metadata.topic:` is NOT orphaned by this change, and a review caught me implying it was.**
The surviving overview target still builds a topic-grouped index from exactly that field, so
`--check` remains a **live gate over live data** rather than a vestige. The framing I used
while briefing the review — *"the two topic-less pages stay invisible to a block that no longer
exists"* — was wrong: they were invisible in the overview index too, which is why fixing them
was worth doing rather than moot.

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

**Cost accepted, stated so nobody re-opens it as a defect:** the janitor's block groups by `tier:
hub` + wikilinks, so the project block's 11 named `metadata.topic:` sections are lost. That is a
real reduction in browsability, and it is the right trade: CLAUDE.md's own header says recall runs
through `memgrep recall`, not through reading this file top-to-bottom, and a topic index nobody
re-generates is worse than a flat one that is always current.

**Why `todo` → `ai_review` skips five columns, stated so an in-harness reader is not confused.**
The DEP overlay's Part B2 table walks `verify_assumptions → plan → dispatch → dev → testing`
before `ai_review`, and none of those ran. That is correct HERE and would not be inside the
harness: this is an external Claude session, where only the IND base binds, and the IND base
mandates a column *vocabulary*, not a sequential walk. The column has to be TRUE, and
`ai_review` is — the work is done and under adversarial review. `complete` is what it may not be
yet, because IND step 12 freezes a terminal body and its exceptions (the closing edit, the
append-only `## Approval log`, archival, removing a machine-verifiably false line) do not cover
*"a review came back with a finding I must write into STATE"* — which is exactly what happened
twice while this card sat here.

**NEXT ACTION.** None pending beyond the acceptance boxes below. If the topic grouping is missed,
the follow-up is a janitor issue asking `claudemd_slim` to group by `metadata.topic:` — not a
revival of the second generator.

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
      shape none of this would catch; the exit-1 argument covers that too, for
      any gate on the local commit path. **What actually makes the residual
      gap tolerable is the guard's failure mode, not the grep:** it was written
      to `exit 1`, not to silently skip, so a caller nobody found fails LOUDLY
      on its first run and names this card — instead of quietly reintroducing
      the duplicate block, which is the outcome the card exists to prevent.
      A missed invoker is therefore a nuisance, not a regression.
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
      (10294 B each). **Caveat, filed as `Emasoft/ai-maestro-janitor#298`:**
      that idempotence holds for the BODY, not for the header. The janitor's
      `corpus_digest` mixes each page's FULL `description:` while the index
      renders `_short_desc()` (first ` / ` segment only), so a description
      edit past that segment flips the digest and rewrites CLAUDE.md with an
      identical body. It fired during this session. The same issue records the
      opposite defect — a file rename or a `tier: hub` change alters the
      rendered body and does NOT flip the digest — so this box means *the
      block does not churn on its own*, not *the freshness probe is correct*.

## Approval log

- 2026-09-04T17:23:18+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
