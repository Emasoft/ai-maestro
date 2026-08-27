---
trdd-id: N83OXS8G
title: The PII gate had no surface that fires before a commit, so it never ran
column: complete
created: 2026-08-27T13:35:47+0200
updated: 2026-08-27T14:05:00+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T13:35:47+0200
priority: 1
severity: high
effort: small
release-via: none
labels: [governance, security, tooling]
npt: []
eht: []
implementation-commits: [2a86cdb9]
---

# The PII gate had no surface that fires before a commit, so it never ran

## Problem

On 2026-08-26 a tracked card carrying the owner's personal gmail address was
committed to this **PUBLIC** repo. `7abfcb54` redacted it; 11 commits in history
still carry it and, per RULE 0.6, will not be rewritten.

The prior framing of this incident was *"a working check whose failure nobody
looked at"* — `tests/governance/no-personal-addresses-in-tracked-files.test.ts`
has existed since 2026-08-07 and DOES catch that file. **That framing is wrong**,
and it matters: it points the fix at a reader, when the defect is a missing
surface.

## Root cause

Measured, not inferred. The gate's only two enforcement surfaces were:

1. a manual `yarn test`, and
2. CI's `yarn test` — whose triggers are `push: [main]` + `pull_request: [main]`
   **only**, deliberately (TRDD-XGFJCCJ9: topic-branch runs mail the owner and
   manufacture the notification fatigue that hides the one real failure).

There was **no `pre-commit` hook at all**: `core.hooksPath` is `.githooks`, which
held `post-checkout`, `post-commit`, `post-merge`, `pre-push` — and `pre-push`
runs report archival plus `git lfs`, no tests.

The work landed on branch `governance-rules`, which has **0 CI runs and 0 PRs**
(`gh run list --branch governance-rules` empty; positive-controlled against an
unfiltered `gh run list`, which returns runs). So every commit on that branch was
gated by nothing.

**A gate with no reachable surface is indistinguishable from a gate that passed.**

## Fix

`.githooks/pre-commit` — runs the **existing** test before the commit enters
history.

- **Commit time, not push time or CI time.** The repo is PUBLIC and RULE 0.6
  forbids the rewrite that would undo a leak, so the commit is the last point at
  which the mistake is still cheap (edit, re-stage). After it there is no fix.
- **Invokes the existing test, never a copy of its regex.** One definition of
  "what a personal address looks like"; a detector keyed on a duplicated pattern
  goes blind the moment the original is edited.
- **Any non-zero exit blocks**, violation and could-not-run alike — a gate that
  cannot run must never report clean.
- **CI triggers are NOT widened.** That would re-open the exact defect
  TRDD-XGFJCCJ9 closed. The missing thing was a pre-commit surface.

Known limits, recorded rather than engineered around: activation is per-clone
(`git config core.hooksPath .githooks`, the pattern the other hooks already
carry); `git commit --no-verify` bypasses it, which is git's own escape hatch and
gets no second one; and the scan reads worktree content for indexed paths, so a
partially-staged file (`git add -p`) is scanned as it appears on disk.

## Verification

Three directions, each failing for its own reason:

| direction | result |
|---|---|
| clean tree | `rc=0`, `[pre-commit] PII gate clean.` |
| a synthetic initial-plus-surname local-part at a real consumer provider, seeded in a staged tracked file | `rc=1`, 1 `BLOCKED` line, **0** `CANNOT RUN` lines, the named test `contains no address that looks like a real person` failed, local-part surfaced, **0** occurrences of the full address in the output |
| gate file / runner unreachable | `CANNOT RUN` + `rc=1` |

The seeded control file was staged, then `git rm --cached`-ed and moved to the
session scratchpad, and a `git grep -l` for its local-part over the tracked tree
returns 0.

The seeded address is DESCRIBED here, never quoted: this file is itself tracked, so
quoting it would plant the very thing the gate exists to keep out — which the hook
proved by blocking this card's own first commit attempt.

The third direction was observed for real: the hook's **first** draft tested
`[ -x scripts/with-node.sh ]`, and that script is mode 644 by design (invoked as
`bash scripts/with-node.sh`) — so both control directions returned `rc=1`,
agreeing with each other and proving nothing, until the `BLOCKED`-vs-`CANNOT RUN`
line counts separated them. Two measurements taken in the same broken environment
agree; that agreement is not evidence.

## Acceptance

- [x] Root cause established by measurement, not inference (no pre-commit hook; CI main+PR only; 0 runs / 0 PRs on this branch, positive-controlled)
- [x] `.githooks/pre-commit` runs the existing gate and blocks on any non-zero exit
- [x] Clean tree passes (`rc=0`)
- [x] A seeded violation in a staged tracked file is blocked, for the gate's own reason and not a could-not-run
- [x] The full address does not appear in the hook's own output
- [x] CI triggers left untouched (TRDD-XGFJCCJ9 not re-opened)
- [x] Seeded control artifact removed from index and worktree; tracked tree verified clean
- [x] Landed and the commit sha recorded in `implementation-commits:`

## Approval log

- 2026-08-27T13:35:47+0200 — MANDATE issued by hub-claude (min-approval-requirement: none).
  Pre-approved: Tier-0 self-mandate — reversible, local, no baseline deviation, no
  governance or `.github/` surface touched. No approval request was sent.
- 2026-08-27T14:05:00+0200 — CORRECTION, appended under the terminal-freeze exemption for this
  section (the body above is frozen and is left as written). An adversarial review found two
  defects in the work this card closed.
  1. OVERREACH. The evidence establishes that NO AUTOMATED SURFACE could have fired the gate. It
     does NOT establish "the gate never ran": a manual `yarn test` leaves no trace, so whether a
     human ran it and committed anyway is unfalsifiable from what was measured. Both stories
     produce exactly the observations recorded above. The fix is correct under either. The card
     spent its length correcting one overreaching framing and should not have replaced it with a
     second.
  2. A FALSE NEGATIVE, in the dangerous direction, in the hook this card shipped. The scan reads
     the WORKTREE while the commit writes the INDEX: `git add` a file carrying an address, edit it
     out of the worktree, and the gate passed over clean bytes while the index carried the address
     into history. Recorded above as a one-line "known limit" about `git add -p`; the severe case
     was the ordinary one. Reproduced, then closed in ddfd0d32 by refusing when the worktree is not
     authoritative for a staged path — not by scanning staged blobs with a second copy of the
     pattern, which would go blind the moment the first is edited. That commit also adds the nine
     behavioural cases the hook shipped without, wired into the suite with a PASS-count floor.
  Also settled since: the corpus-scanning tests used for the no-regressions claim resolve their
  root via `process.cwd`/`__dirname`, which is worktree-local — not the `git worktree list` idiom
  that would have returned the MAIN checkout and voided that comparison.
