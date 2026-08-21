---
trdd-id: N4SDG0ML
title: Make main CI green — the fast-forward exposed 3 pre-existing failure classes to GitHub CI
column: todo
created: 2026-08-08T15:45:11+0200
updated: 2026-08-21T17:12:00+0200
current-owner: ai-maestro-hub
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
