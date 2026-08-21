---
trdd-id: N4SDG0ML
title: Make main CI green — the fast-forward exposed 3 pre-existing failure classes to GitHub CI
column: human_review
created: 2026-08-08T15:45:11+0200
updated: 2026-08-21T18:09:41+0200
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
- [ ] 3. **CI-environment-only (4 files, ALL PASS LOCALLY)**: `cli-help-exit-contract`,
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
`~/.claude/rules/how-to-fix-issues-of-other-projects.md` forbids editing it directly: the only
two permitted routes are (1) file an issue on their tracker, or (2) fork → branch → PR, and (2)
requires the OWNER to explicitly ask for the patch to be authored. **The body's "one-line change,
on main, by whoever is there" reads as if it were ours to do. It is not.** No agent may act on
this without the owner choosing a route.

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
- [ ] Class 3: all 4 files green ON THE RUNNER (verified by a main CI run, not locally)
- [ ] Class 2: resolved by TRDD-4UX1YFLG's ruling (either the retrofit or a ratchet
      exemption with the WHY recorded in the test)
- [ ] A main push completes CI green end-to-end; the USER stops receiving failure mail

## Approval log

- 2026-08-08T15:45:11+0200 — MANDATE (self, Tier-0): hub CI hygiene, in-scope, reversible.
