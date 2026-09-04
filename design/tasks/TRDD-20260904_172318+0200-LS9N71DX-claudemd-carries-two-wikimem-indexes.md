---
trdd-id: LS9N71DX
title: CLAUDE.md carries two wikimem indexes over the same corpus
column: todo
created: 2026-09-04T17:23:18+0200
updated: 2026-09-04T17:23:18+0200
current-owner: user
created-by: user
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: user
approval-datetime: 2026-09-04T17:23:18+0200
---

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

- [ ] Grep the whole repo for every consumer of `scripts/wikimem-index.mjs`
      (tests, CI workflows, `package.json` scripts, docs, README, other
      TRDDs) BEFORE removing anything — the script documents a `--check`
      mode that may be pinned by a gate.
- [ ] Grep the whole repo (and the janitor plugin cache, if reachable) for
      every trigger of `claudemd_slim.py` (SessionStart hook, PostCompact
      hook, any script/cron invoking it) before removing anything.
- [ ] Decide and record which generator is kept and which is retired.
- [ ] Retire the losing generator's WRITE PATH to CLAUDE.md (not merely its
      current output) so the oscillation cannot recur.
- [ ] Confirm CLAUDE.md ends with exactly one wikimem index block after the
      change.
- [ ] Confirm the kept generator's output is idempotent (no diff on a
      no-op re-run).

## Approval log

- 2026-09-04T17:23:18+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
