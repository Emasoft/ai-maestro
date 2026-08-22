---
trdd-id: 2P25M6AS
title: The deployed trddgrep is 23 days stale so validate cannot see new rules
column: cancelled
created: 2026-08-22T21:09:35+0200
updated: 2026-08-22T21:22:47+0200
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
- 2026-08-22T21:22:47+0200 — CANCELLED by main. **The premise is FALSE. `trddgrep` is not stale
  and never was.** Retraction below; the card is kept, not deleted, because the reasoning error is
  worth more than the card was.

## ⛔ RETRACTED — 2026-08-22T21:22:47+0200 — the defect does not exist

**Everything above this line is WRONG.** `trddgrep` runs current code on every invocation.

`~/.local/bin/trddgrep` is not a copy of `scripts/trddgrep.mjs` at all — it is **`pillar-cli.sh`,
the ONE bash launcher** behind `memgrep` / `trddgrep` / `prrdgrep` / `specgrep` (TRDD-217AYEOT: one
implementation, N entry points, dispatching on the name it was invoked as). Its last line is:

    exec node --import "file://$TSX_ENTRY" "$ROOT/scripts/$TOOL.mjs" "$@" --design-dir "$PWD/design"

It **execs the live repo source**. There is no copy to go stale, and its own `Jul 30` mtime is
correct and expected — a launcher does not change when a rule is added to the tool it launches.

**POSITIVE CONTROL, which is the check that should have been run before filing.** Seed one `Z`
date into a card and ask both tools:

    trddgrep validate            -> DATE-NOT-LOCAL-OFFSET  1 hit
    scripts/trdd-doctor.mjs      -> DATE-NOT-LOCAL-OFFSET  1 hit

Identical. The deployed gate sees the rule added minutes earlier.

## Why three signals all pointed the wrong way

Each was consistent with "stale binary" and **not one of them was evidence**:

| signal | what I read | what it actually meant |
|---|---|---|
| `cmp` says DIFFERS | a stale copy | a *launcher* vs an *implementation* — two different files. 5428 vs 51370 bytes, and I never looked at the sizes I had already printed |
| `trddgrep validate` → 0 hits for the new rule | the gate is blind | **the corpus was already clean.** I ran it AFTER the backfill, so there was nothing to find |
| PATH file dated `Jul 30 07:51` | 23 days behind | the launcher's date, which correctly never moves |

**The governing lesson, already written in `.claude/rules/lessons-verification.md`, violated while
filing a card about verification discipline:** *a zero is not a result until a positive control
proves the instrument can see something you KNOW is there.* The control here costs one `perl -pi`
and one command. It converts "0 hits" from a finding into a measurement, and it is the ONLY thing
that separates *the gate is blind* from *the corpus is clean* — two states with identical output.

Second lesson, narrower and worth naming: **`cmp` answers "are these bytes the same", never "is
this a stale version of that".** Reaching for it presupposes the two files are the same KIND of
thing. Read the head of an unfamiliar executable before comparing it to anything — the first
twenty lines said "the ONE launcher behind every pillar CLI" in plain English.

Nothing was broken and nothing needed fixing. No commit reverted; the false finding never reached
code, only this card and the two that cite it, both corrected via their append-only Approval logs.
