---
trdd-id: 2P25M6AS
title: The deployed trddgrep is 23 days stale so validate cannot see new rules
column: todo
created: 2026-08-22T21:09:35+0200
updated: 2026-08-22T21:09:35+0200
current-owner: main
created-by: main
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: main
approval-datetime: 2026-08-22T21:09:35+0200
---

# The deployed trddgrep is 23 days stale so validate cannot see new rules

## Problem

The `trddgrep` on PATH is **stale**, and every governance verification run through it this
session measured with a 23-day-old binary.

Measured 2026-08-22:

    $ ls -la $(command -v trddgrep)
    -rwxr-xr-x  5428  Jul 30 07:51  /Users/<owner>/.local/bin/trddgrep
    $ cmp -s "$(command -v trddgrep)" scripts/trddgrep.mjs   ->  DIFFERS

Consequence, and it is the reason this is filed rather than noted: `trddgrep validate` returns
**0 hits** for `DATE-NOT-LOCAL-OFFSET` (landed in `a04bafbf`), because a rule added today cannot
exist in a binary built on Jul 30. The rule is real and `lintCorpus` reports it; the deployed gate
cannot see it.

This also means the tripwire `trddgrep validate` -> "ERRORs must stay exactly 2" — used in the
S13L6R9R handoff and re-run at resume — was measured with the stale tool. The number happened to be
right, which is exactly what makes this class of defect durable: a stale gate agrees with a fresh
one until the moment it matters.

**This is the fleet's recurring "fixed vs deployed" split**, and the standing rule already names it:
a commit landing and the code RUNNING are two claims. It is also the CLI-verify-on-PATH rule
(`~/.claude/rules/cli-verify-on-path.md`) — verify a CLI change through the bare command name the
user actually runs, never through the repo-relative source.

## Proposed fix

1. Establish how `~/.local/bin/trddgrep` is produced from `scripts/trddgrep.mjs` (copy? build?
   symlink that was later replaced by a copy?) — the answer decides whether this is a one-off or a
   pipeline with no redeploy step.
2. Re-deploy, then verify BEHAVIOURALLY through the bare name: `trddgrep validate` must report the
   `DATE-NOT-LOCAL-OFFSET` rule (seed a `Z` date to prove the needle fires; a 0 on a clean corpus
   is indistinguishable from a blind gate).
3. Prefer a symlink over a copy, so the two can never diverge again. If a copy is required, add a
   staleness check — the same shape as the deployment census this repo already runs.

## Verification

- `cmp "$(command -v trddgrep)" scripts/trddgrep.mjs` exits 0, OR the PATH entry is a symlink
  resolving into the repo.
- With a seeded off-format date, `trddgrep validate` NAMES `DATE-NOT-LOCAL-OFFSET` — the positive
  control, without which "0 findings" proves nothing.
- The exit-code trichotomy is unchanged (0 clean / 1 findings / 2 could-not-run).

## Scope note

Filed rather than fixed in-flight: redeploying a CLI on the owner's PATH is an act outside this
card's repo tree, and S13L6R9R was mid-close. Not silently absorbed.

## Approval log

- 2026-08-22T21:09:35+0200 — MANDATE issued by main (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
