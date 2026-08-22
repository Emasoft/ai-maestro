---
trdd-id: N4SDG0ML
title: Make main CI green — the fast-forward exposed 3 pre-existing failure classes to GitHub CI
column: completed
created: 2026-08-08T15:45:11+0200
updated: 2026-08-22T18:39:54+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
labels: [ci, main-branch]
external-refs: [ai-maestro#138, TRDD-4UX1YFLG]
---

# Make main CI green

The 2026-08-08 fast-forward (#138) gave this content its FIRST GitHub CI runs — the CI
workflow triggers only on `main` pushes, and `governance-rules` was only ever tested
locally. Every main push now fails CI and notifies the USER. Run 31259820896 (14 failed
tests / 7 files) decomposes into three classes:

1. **Mine, FIXED same day (`58fdad80`)**: the new heal script was unannounced in
   `docs/SCRIPT-MANIFEST.md` — 2 files red (R23.8 gate + manifest `--check`). Renamed
   `heal-amp-addresses.sh` (out of the frozen `amp-*` family, per the builder's
   by-construction discriminator), announced Tier C, counts 27→28 / 87→88. 6/6 green
   locally.
2. **The known ratchet (1 file)**: `aio-txn-10-runner-coverage` —
   `RefreshAllMarketplaces` hand-rolled (1 vs ratchet 0). Cannot be retrofitted as
   designed (one terminal side effect, no rollback window); governance proposal pending a
   MANAGER-tier ruling — `TRDD-4UX1YFLG`. Blocked on that ruling.
3. **CI-environment-only (4 files, ALL PASS LOCALLY)**: `cli-help-exit-contract`,
   `teams-stats-verb`, `check-decoupling-blank-is-not-a-finding`,
   `oauth-rotator-supervisor`. Linux-runner signatures in the log: `EACCES mkdir
   '/home/.claude'` / `'/home/test'` (HOME-relative fixtures not redirected on the
   runner), a missing `ChangeMetadata` mock export surfacing only there, `Cannot find
   module './agent-registry'`. Diagnose EACH on the runner (do not guess from the log —
   per-file isolation, the suite-interleaving misattribution lesson applies), fix the
   FIXTURES (env-redirect `$HOME`, complete the mock), never weaken the tests.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21T18:09

**STOP: "main" here is `23blocks-OS/ai-maestro` — a THIRD-PARTY UPSTREAM repo, not the owner's
fork.** Measured, not inferred:

```
$ gh run view 32328280362 --json url
    https://github.com/23blocks-OS/ai-maestro/actions/runs/32328280362   ← upstream
$ git remote -v
    origin  https://github.com/23blocks-OS/ai-maestro.git   ← what `origin/main` means
    fork    https://github.com/Emasoft/ai-maestro.git       ← where our work lands
$ git ls-remote origin main → 7683d7b1…   (== the failing run's headSha)
$ git ls-remote fork   main → 2ae3e38d…   (a DIFFERENT commit)
```

So this card's remaining work is **a one-line fix to someone else's repository**, and
`~/.claude/rules/how-to-fix-issues-of-other-projects.md` forbids editing it directly. **The
body's "one-line change, on main, by whoever is there" reads as if it were ours to do. It is
not.**

### ✅ ROUTE CHOSEN AND EXECUTED — owner directive 2026-08-21

> *"never file an issue on 23blocks-OS/ai-maestro. solve it yourself in our fork."*

Done. **`fix/agent-dir-hint-tmpdir` (`c26aa4b8`) is pushed to `Emasoft/ai-maestro`.** Nothing
was sent to `23blocks-OS` — no issue, no PR, no push.

**The fix ALREADY EXISTED and was about to be lost.** It sat as a committed local branch off
`origin/main`, correct and complete (one hunk, `/private/tmp/hint-` → `/tmp/hint-`, with the
`os.tmpdir()` trap documented in a comment), **pushed nowhere** — so it would have died with
this machine, while this card said "by whoever is there". Third instance today of a recorded
blocker that had already been resolved and nobody re-read.

### And nothing is actually broken IN OUR FORK — measured, not assumed

```
$ gh run list --repo Emasoft/ai-maestro --limit 3
    2026-08-15  main  CI  success ×3      ← our fork's CI is GREEN
```

The red CI this card is named for is **upstream's**. Our fork does not carry
`tests/agent-dir-hint.test.ts` at all: `fork/main` and `governance-rules` are both **232
commits behind** upstream, and `0d0ec010` (#398) added that file inside that gap. So the fix is
**pre-positioned**, not remedial — it matters the day those 232 commits are synced, and until
then our line has nothing to fail on.

**Merging this branch into `fork/main` would therefore be a SYNC, not a fix** — the PR would
carry 232 upstream commits alongside the 6-line change. That is a separate decision and is not
taken here.

### Unrelated but found while measuring: 381 commits are unpushed

`fork/main` and `fork/governance-rules` are the SAME commit, and both are **381 behind local
HEAD** — every commit since 2026-08-08, including all of TRDD-A9335BZ6, exists only on this
disk. Fork CI has not run on our branch since 2026-08-08 (green then). Not this card's scope;
recorded because it is a real durability gap and the measurement was already in hand.

**The diagnosis itself is CONFIRMED first-hand** (so whoever gets the go-ahead has a proven
one-liner, not a theory):

- `origin/main:tests/agent-dir-hint.test.ts:69` — `fs.mkdtempSync('/private/tmp/hint-')`, the
  only macOS-only path in the file (68 and 6 are comments).
- Runner error, verbatim: `ENOENT: no such file or directory, mkdtemp '/private/tmp/hint-XXXXXX'`.
- Run 32328280362 totals: **`Test Files 1 failed | 29 passed (30)`** — it is the ONLY red file.
  (The ~500 `Failed to …` lines earlier in that log are the EXPECTED output of negative-path
  tests, not failures. Counting them is the substring trap.)
- `origin/main:lib/agent-registry.ts:243` covers `/claude-501/`, `/private/tmp/` AND `/tmp/`, so
  `'/tmp/hint-'` is skipped on both platforms. Verified on macOS myself:
  `mkdtempSync('/tmp/hint-')` → `/tmp/hint-AUCPz1`, `startsWith('/tmp/')` **true** (mkdtemp does
  not resolve the symlink). And `os.tmpdir()` here returns `/var/folders/j5/…`, which that guard
  does NOT cover — so the obvious "portable" fix is the one that breaks macOS.

### The acceptance box "a main push completes CI green" covers a far smaller population than it sounds

`vitest.config.ts` on main includes `tests/**/*.test.ts`, and **origin/main holds 30 test files
while this branch holds 432**. Main CI has therefore never run 93% of the suite. Whenever
`governance-rules` merges, ~400 files reach GitHub CI for the FIRST time — which is precisely the
event that created this card, about to repeat at 13×. Class 3's four "CI-environment-only"
files are moot for the same reason: they are not on main yet, so their green on the runner has
not been observed, it has been assumed from their absence.

## ⏹ 2026-08-21 — main CI is down to ONE failing test, and it is not on the class-3 list

Run `32328280362` (main, 2026-08-20): `lint` green, `test (22)` red on **1** test — not the 14/7
this card was written against.

**`tests/agent-dir-hint.test.ts > is a no-op for root, scratch, empty-name, and missing dirs`**
— `fs.mkdtempSync('/private/tmp/hint-')`, a **macOS-only path**, ENOENT on the Linux runner.

Fix is `'/tmp/hint-'`: `lib/agent-registry.ts:243` already skips `startsWith('/tmp/')`, and macOS
`/tmp` symlinks to `/private/tmp`, so one literal covers both. **`os.tmpdir()` is the WRONG fix** —
on macOS it returns `/var/folders/…`, which that guard does not cover, so the hint would be written
and the test would fail there instead. Verified: `mkdtempSync('/tmp/hint-')` → `/tmp/hint-FbH869`.

Not applied here: this branch is **3449 ahead / 232 behind** `origin/main` and does not contain the
file. One-line change, on main, by whoever is there.

```
gh run view 32328280362 --log-failed | grep -A6 'no-op for root'
git show origin/main:tests/agent-dir-hint.test.ts | grep -n 'private/tmp'
```

## Acceptance

- [x] Class 1 fixed and pushed (`58fdad80`)
- [~] Class 3: all 4 files green ON THE RUNNER (verified by a main CI run, not locally) —
      **DESCOPED to TRDD-GMWH3NG5.** Unreachable from here by construction: the box demands a
      run of the CURRENT tree, and the current tree is 157 commits from any CI-visible `main`.
      No amount of agent effort produces that run; only the owner's push does.
- [x] Class 2: resolved by TRDD-4UX1YFLG's ruling (either the retrofit or a ratchet
      exemption with the WHY recorded in the test) — **SATISFIED, verified first-hand
      2026-08-22.** The ruling landed: `4UX1YFLG` is `column: completed`, `approved: true`,
      `approval-judge: manager (emasoft-assistant-manager)`, `approval-datetime:
      2026-08-08T16:22:38+0200`, `implementation-commits: [36dcf799]`. It was neither of the
      two shapes this box anticipated and is BETTER than both — **not an exemption**: the
      MANAGER ruled R51 already satisfied in its limit case, so `MAX_HANDROLLED` stayed **0**
      (`tests/governance/aio-txn-10-runner-coverage.test.ts:190`) and the ratchet never moved.
      The WHY is in the test as the box requires — the `R516_LIMIT_CASES` docblock (`:192-205`)
      carries the ruling's reasoning verbatim, and the entry is **SELF-INVALIDATING**: it
      records the pipeline's exact gate count and a companion test voids it the moment a second
      gate lands. That bar has already fired once (2026-08-19, count 1→2, revisit performed).
      Test re-run today under the pinned toolchain: `Test Files 1 passed (1) · Tests 5 passed
      (5)`, exit 0.
- [~] A main push completes CI green end-to-end; the USER stops receiving failure mail —
      **DESCOPED to TRDD-GMWH3NG5.** The box is about the PUSH, and pushing to a PUBLIC
      shared repo is an owner-only act the decide-on-my-behalf delegation does not revoke.

## Approval log

- 2026-08-08T15:45:11+0200 — MANDATE (self, Tier-0): hub CI hygiene, in-scope, reversible.
- 2026-08-22T18:38:48+0200 — **HUMAN REVIEW → COMPLETE**, under the owner's standing grant
  (*"i authorized you to decide on my behalf, so you must do the human review and also decide
  all the rest. just decide in base of verified facts and tests, never assume anything"*).
  Verdict and its evidence are recorded in the closing section below. Two boxes reshaped to
  `[~]` and descoped to **TRDD-GMWH3NG5** because both gate on the owner's push, not on effort.
- 2026-08-22T16:39:49.324Z — column → complete. Human review under the owner's standing grant. Class 2 CLOSED on first-hand evidence (4UX1YFLG completed+manager-approved 2026-08-08; MAX_HANDROLLED still 0; R516_LIMIT_CASES docblock carries the ruling and self-invalidates on gate count; ratchet re-run today 5/5 green exit 0). The two push-gated boxes reshaped to [~] and descoped to TRDD-GMWH3NG5 — pushing to a PUBLIC shared repo is an owner-only act. Also repaired a stray '- [ ] 3.' gating box in the prose that countAcceptanceBoxes counts corpus-wide.
- 2026-08-22T16:39:54.092Z — COMPLETED by user. 3 boxes resolved (1 pre-existing [x], 1 closed on verified evidence, 2 descoped to TRDD-GMWH3NG5 as owner-only acts)..

## ⏹ 2026-08-22T15:2x — CI IS GREEN, AND THAT DOES NOT SATISFY THE LAST BOX

Measured live: `gh run list --repo Emasoft/ai-maestro --branch main --limit 5` → the five most
recent runs are **all `success`** (CI ×2, Test Installers, CI, CI), newest `2026-08-21T18:09Z` —
minutes before this card's own `updated:` stamp. So the three failure classes are, as far as the
runner is concerned, **not failing on `main` today.**

**But the green is about a tree that is 101 commits behind.** `git rev-list --left-right --count
fork/main...HEAD` → `0 101`. Nothing has been pushed since, so the newest CI result describes a
`main` that lacks 101 commits of local work — including everything landed today.

**That is exactly what the last box guards against, and it is why it is worded as it is:**

> *A main push completes CI green end-to-end; the USER stops receiving failure mail*

A green run on a stale `main` is a true statement about the wrong tree. It cannot close that box,
because the box is about the push — the event that would put the 101 commits in front of the
runner for the first time. Same shape as `44RGLOO8` measured earlier today: a real, passing,
verifiable state that is nonetheless about something other than the thing being claimed.

**Class 3 (`- [ ]` at :149) is likewise NOT closable from here.** It says *"green ON THE RUNNER
(verified by a main CI run, not locally)"* — and the 4 files it names all pass locally already, so
only a run of the CURRENT tree answers it. That run does not exist yet.

**⛔ Not attempted: the push.** ~101 commits, two PUBLIC remotes, and *never push to a shared
repository unless explicitly told* is a standing prohibition the owner's decide-for-yourself
delegation does not revoke. This card is therefore **correctly parked in `human_review`** — its
remaining boxes are gated on an act only the owner can authorize, not on effort.

**Re-derive, do not trust the numbers above** — both have silent timestamps:
`gh run list --repo Emasoft/ai-maestro --branch main --limit 5` ·
`git rev-list --left-right --count fork/main...HEAD`

## ⏹ 2026-08-22T18:38+0200 — REVIEW VERDICT: COMPLETE (2 boxes descoped, 1 closed on evidence)

The card's own last section (`15:2x`) was right that the two push-gated boxes cannot be closed
from here, and wrong to leave the whole card parked on them — **the third box was closable and
nobody re-read it.** That is the fourth instance of the same shape today: a recorded blocker
that had already been resolved.

### What moved

| Box | Was | Now | Why |
|---|---|---|---|
| Class 1 | `[x]` | `[x]` | unchanged (`58fdad80`) |
| Class 3 green on the runner | `[ ]` | `[~]` | needs a CI run of the current tree ⇒ needs the push |
| Class 2 / `4UX1YFLG` ruling | `[ ]` | `[x]` | the ruling landed 2026-08-08 and its WHY is in the test |
| A main push completes CI green | `[ ]` | `[~]` | the push is an owner-only act |

### Evidence for the box that closed (verified first-hand, not inherited)

```
$ find design -iname '*4UX1YFLG*'
    design/archived/TRDD-…-4UX1YFLG-….md      ← archived/, column: completed
      approved: true · approval-judge: manager (emasoft-assistant-manager)
      approval-datetime: 2026-08-08T16:22:38+0200 · implementation-commits: [36dcf799]

$ grep -rn 'R516_LIMIT_CASES' --include='*.ts' .
    tests/governance/aio-txn-10-runner-coverage.test.ts:206,283,300
    …:190  const MAX_HANDROLLED = 0        ← the ratchet never moved

$ bash scripts/with-node.sh npx vitest run tests/governance/aio-txn-10-runner-coverage.test.ts
    Test Files  1 passed (1)
    Tests       5 passed (5)          exit=0
```

The docblock at `:192-205` states the ruling in the test itself, which is exactly what the box
asked for — and it goes further than the box's own wording by making the entry **self-invalidating
on gate count**, so the exemption-shaped failure mode (a carve-out nobody revisits) is checkable
rather than promised. The bar has already fired once, on 2026-08-19.

### Instrument note — the stray gating box at `:35`

The body's class-3 paragraph carried a `- [ ] 3.` prefix: item **3** of a `1./2./3.` prose
decomposition that had acquired checkbox syntax. `lib/trdd-doctor.ts::countAcceptanceBoxes`
counts **every** box in the whole body, not only the ones under `## Acceptance` (read it — the
scan starts at `bodyStartIndex`, and `[~]` counts toward `total` but not toward `open`). So that
paragraph was a live gate duplicating an Acceptance box, and it would have blocked the terminal
transition for a reason no reader would have looked for. Restored to plain `3.` — a mechanical
repair that changes no fact.

### Re-derived today (both numbers have a silent timestamp — re-run, do not quote)

```
$ gh run list --repo Emasoft/ai-maestro --branch main --limit 5
    5/5 success · newest 2026-08-21T18:09:28Z at f75f72fa
$ git rev-list --left-right --count fork/main...HEAD
    0   157        ← was 101 yesterday; the gap is WIDENING, not closing
```

157, not 101. The durability gap this card noticed in passing is growing by ~56 commits/day, and
that is the real content of `TRDD-GMWH3NG5` — not CI hygiene.
