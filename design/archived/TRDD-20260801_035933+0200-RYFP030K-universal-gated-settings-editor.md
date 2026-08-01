---
trdd-id: RYFP030K
title: one gated universal editor for settings.json and settings.local.json across the whole fleet
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-01T03:59:33+0200
updated: 2026-08-02T01:38:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-01T03:59:33+0200
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
external-refs: [https://github.com/Emasoft/ai-maestro/issues/105]
implementation-commits: [4fc3f93e, 34008c2e, 56331de3, f27b772a, 420cac1e, 4d94097c, f1680b41, 1ed50bc2, f2be0ebb, ec38b089, 12e2ef97, 2c47ab89, 9b6d4f0e]
---

## ⏵ STATE — READ THIS FIRST ON RESUME

### ⚠ 2026-08-01T19:2x — THIS CARD STALLED, AND THE TRANSPORTS ARE NOW DELEGATED

Between 05:00 and 19:20 this card sat at `column: dev` while nothing touched it: the USER
redirected to the OAuth rotator and I followed without queueing or delegating this. The board
asserted `dev` the whole time, so the stall was invisible until the USER asked *"have you
implemented the safe settings editor?"*. That is the incident behind the new global rule
`~/.claude/rules/new-directive-never-drops-the-old-work.md` — on a new directive, QUEUE the new
work or FORK the old, and say which.

**The transports row is DONE** — delegated at 19:2x, landed `12e2ef97`. Verified first-hand, not
taken on report: `tsc` 0, full suite **331 files** (was 328), the 3 new files carry 43 tests, the
CLI greps ZERO HTTP references (the installer-runs-server-down constraint), the gate writes only
via `updateJson`, the governance ratchet is still green, and a neuter of the basename guard
reddened exactly `REJECTS a filename that is not one of the two known settings basenames`.
Three editor diagnostics (2 unreachable-code, 1 unused `isValidOp`) were all STALE — `isValidOp`
is called at `route.ts:102`, and `tsc --allowUnreachableCode false` reports nothing.

### ⏩ 2026-08-02T01:30 — THE 21 SITES ARE DONE (`2c47ab89`, `9b6d4f0e`). ONLY #105 REMAINS.

**NEXT ACTION, runnable as written:** report the adopted/declined set on issue #105
(`gh issue view 105`) — the last open box. It is an OUTWARD-FACING write, so it needs the R22 /
PRRD G1.1 authorship self-identification line.

**What the 21 turned out to be:** 20 read-modify-writes → `updateJson`; ONE true compensation →
`restoreRawSnapshot`. The grep heuristic flagged 6 as compensations and **all 6 were wrong** —
read the enclosing gate, never the neighbourhood. Two undos LOOK like compensations and are not:
they rebuild the settings key-by-key from a ledger *specifically so a concurrent writer's edit
survives the rollback*, which is a read-modify-write by construction.

**THE PART THAT WAS NOT MECHANICAL, and the reason this was withheld from the fork.**
`updateJson` RE-RUNS its mutator when the staleness gate catches a non-participating writer, and
three sites recorded R51 undo state *inside* the write:

| site | what a retry did to it |
|---|---|
| EXE install/uninstall/enable/disable | pushed the undo entry TWICE; the ledger pops LIFO, so the stale second entry restores the value the retry existed to respect |
| the EXE undo | POPPED the shared ledger from inside the mutator — attempt 1 drained it, attempt 2 restored nothing, produced bytes identical to its base, and reported `changed:false`: an undo that silently did nothing while reporting success |
| the hooks undo | gated on `c.prior`, which the mutator sets on EVERY attempt including abandoned ones — so exhausting the retries threw having written nothing while `prior` held a discarded base, and replaying it would destroy the concurrent writer that caused the retry |

Fixed by staging into a local that resets per attempt and publishing after the commit; by draining
the ledger into a local first; and by gating on `committed` (from `updateJson`'s own `changed`).
**`9b6d4f0e` pins the contract those depend on** — that the mutator can run twice — because nothing
else stated it and removing the staging would otherwise read as harmless simplification.

`updateJson` can also THROW where `saveJsonSafe` could not, so the two "latent compensation"
comments that justified themselves with *"saveJsonSafe is atomic, nothing can fail"* were rewritten
rather than left reading as still-true.

**TWO INSTRUMENTS WENT BLIND ON THE RENAME** — same class, opposite directions, both caught:
the window-boundary scanner's `MUTATION_NEEDLES` had no `updateJson`, so it could not see a single
settings write in the file it exists to scan, and its "no settings write above the R51 boundary"
loop was keyed on `saveJsonSafe` alone — a needle that can now never match, i.e. a guard that would
have passed forever while checking nothing. In the service test the same thing hit the ABSENCE
assertion (*"installPluginLocally must not write settings itself"*): `undefined` is exactly what it
wants, so it would have kept passing. **A needle keyed on a verb NAME goes blind on the rename that
replaces it — extend the needle list in the SAME commit that introduces a write primitive.**

**A `mkdir` I added to `updateJson` was REVERTED**: its neuter reddened nothing, because
`acquireLock` already creates the parent to put its lockdir beside the target. Dead code that read
as a fix. The guarantee is now pinned by a test naming `acquireLock` as its true owner, so nobody
re-adds it.

### Where it stands — 2026-08-01T05:00

**The GATE EXISTS, IS TESTED, AND EVERY PREVIOUSLY-UNLOCKED WRITER NOW GOES THROUGH IT.** What
remains is the 21 sites that were ALREADY locked, plus the transports.

| | |
|---|---|
| `lib/json-io.ts` — `withJsonLock` · `updateJson` · fsync · backup+prune · staleness gate · post-commit audit · reentrancy | **done**, `4fc3f93e` |
| the second lock implementation deleted, its knowledge relocated | **done**, `34008c2e` |
| 11 tests on the real filesystem + 5 neuters recorded by name | **done**, `56331de3` `f27b772a` |
| **the THIRD lock found and removed** (claude-adapter, 2 sites) + 3 tests | **done**, `420cac1e` `4d94097c` |
| the 4 UNLOCKED writes of the user's own settings.json (role-plugin ×3, plugin-storage ×1) | **done**, `f1680b41` |
| the marketplaces route's 5 UNLOCKED writes + the test-hygiene tripwire | **done**, `1ed50bc2` |
| ratchet widened to `settings.local.json`, neuter verified | **done**, `f2be0ebb` |
| **ChangeClient's 3 RAW `writeFileSync` sites** + `restoreRawSnapshot` | **done**, `ec38b089` |
| the 21 ALREADY-LOCKED `saveJsonSafe` sites in `element-management-service.ts` | **done**, `2c47ab89` + `9b6d4f0e` |
| API route + `aimaestro-settings.sh` (node entrypoint) | **done**, `12e2ef97` |
| adopted/declined set reported on issue #105 | **NOT STARTED** ← the only one left |

### `lib/json-io.ts` IS NOW THE ONLY PERMITTED WRITER OF `settings.local.json`

That is the mandate, met for that file. The widened ratchet enforces it with an allowlist of exactly
one entry, and the debt line it carried for twenty minutes is PAID — not dropped: all three
ChangeClient writes moved INTO json-io, which is also in `KNOWN_INDIRECT_WRITERS`.

**One of those three was a LIVE instance of the original destroy-the-config bug** — G08's write-back
fallback did `try { JSON.parse(readFileSync(…)) } catch { /* keep empty */ }` and then REPLACED the
file, i.e. a corrupt file became `{}` and every key it held was destroyed. The 2026-07-07 shape,
still in the tree. `updateJson` refuses an unparseable target, so it now warns and leaves the file.

`restoreRawSnapshot` is the THIRD kind of write this codebase needs, alongside `updateJson` (locked
RMW) and `saveJsonSafe` (guarded whole-object write): a compensation replays bytes captured BEFORE
the forward path ran, so it must NOT parse and must NOT get a staleness baseline — but it must be
atomic and locked, which the bare `writeFileSync` it replaces was not.

**11 of 32 `saveJsonSafe` sites migrated + all 3 raw `writeFileSync` sites, and they were the RIGHT ones** — measured, not chosen by convenience.
Every one of them wrote with NO cross-process lock; the 21 that remain are already inside
`withSettingsLock`, which now delegates to the same lockdir `updateJson` takes. So the lost-update
surface is closed; migrating the rest buys them fsync, a kept backup, and the staleness gate.

**NEXT ACTION, runnable as written.** The 21 remaining sites are all in
`services/element-management-service.ts`. For each, decide by ONE question — *is this an R51
COMPENSATION?* A compensation writes `c.prior`, a snapshot taken before the forward path ran, and it
MUST NOT get a staleness baseline because the file legitimately changed in between; those KEEP
`saveJsonSafe`. Everything else is a read-modify-write and becomes `updateJson`.

A grep heuristic (`undo:|compensat|c\.prior|restore the|rollback` within 30 lines) flags **6** of the
21: lines 1191, 4835, 5630, 5643, 6416, 6423. **Treat that as a hint, not a verdict** — I verified
the clearest pair by hand and it was already wrong once: 6423 IS a compensation (`undo: async (c) =>
… saveJsonSafe(settingsPath, c.prior)`), while 6416 is the FORWARD write in the same gate's `run`
and merely sits close enough to match. Read each site's enclosing gate before deciding.

### THE INCIDENT WORTH READING BEFORE TOUCHING ANY MORE CALL SITES

Running the suite after migrating the marketplaces route **wrote the developer's own
`~/.claude/settings.json`.** Both route test files mock `@/lib/json-io` by spreading the real module
and replacing NAMED exports; they replaced `saveJsonSafe`, the route now calls `updateJson`, so the
mock faithfully mocked a function nobody called and the REAL writer ran against the REAL global
config. The suite reported ordinary assertion failures. Nothing said the config had been edited.

Recovered fully — removed through the gate itself, and the file is byte-identical to the backup
`updateJson` took before its own stray write. That was an unplanned live test of the recovery
guarantee, and it held.

**`tests/helpers/real-home-untouched.ts` now guards both files** and is verb-agnostic, so it cannot
go blind the same way. **Add it to any test that touches a settings writer.** This is the same
failure class as the write-boundary detector going blind (below) — twice in one session, in opposite
directions, from one cause: a needle that knows one verb.

### What the neuters proved (a green test pins nothing until something is broken)

1. `withJsonLock` made a pass-through → **2 red**: the two concurrency tests. Also informative: the
   staleness gate turned the unlocked race into a hard `ConcurrentModificationError` rather than a
   silent lost update, so the lock and the gate are two real layers, not one restated twice.
2. store `mine.then(...)` instead of `mine` (Fable's bug #3) → **1 red**: the queue-drain test. The
   other 10 stayed green, which is the proof the `_inProcessQueueSizeForTests` probe was NECESSARY —
   behaviour alone cannot distinguish a draining queue from a leaking one.
3. disable the `held?.has(filePath)` early return → **1 red**: the reentrancy test.
4. delete the `padStart` in `keepBackup` → **1 red** — but **0 red before the fixture was pinned**.
   See the trap below.
5. disable the key-loss tripwire → **1 red**: the rebuilt-minimal-object test.

### THREE DEFECTS THE TESTS FORCED OUT — none was visible by reading

- **`updateJson` DROPPED its lock options.** `JsonLockOpts` lived on `withJsonLock` and was never
  forwarded, so `staleMs`/`maxWaitMs` were unreachable from the only function anyone is supposed to
  call. An option that exists only on the primitive nobody calls directly is not an option.
- **`keepBackup` retained the WRONG ten.** The prune sorts lexicographically and the stamp is
  second-precision, so a burst inside one second is ordered by the counter alone — unpadded, `"10"`
  sorts before `"2"`. At 21 backups it kept 2-9 and 20-21 while deleting 10-19: it discarded the
  MIDDLE and retained the oldest. "Recoverable from a kept backup" rests on this.
- **The prune test was passing under its own neuter.** The counter is module-global, so by the time
  that test ran it was past 40 — thirteen 2-digit counters that sort correctly either way. The
  fixture never straddled the digit-width boundary that is the only place padding matters. Pinning
  it to 5 (spanning 6..18, crossing 9 → 10) is what made the neuter red. A shared module-global
  makes a test's discriminating power depend on test ORDER, and that is indistinguishable from
  coverage until something is broken.

### TWO MORE DEFECTS THE MIGRATION SURFACED, both about instruments going blind

- **There were THREE lock implementations, not two.** This card's own measurement said two. A grep
  for `withSettingsLock|withJsonLock` returned 0 for `lib/client-plugin-adapters/claude-adapter.ts`,
  which reads as "unlocked" — it was locked by `withLock(settingsLockKey(path))`, a string key in
  `lib/file-lock.ts`'s in-process Map. It guarded the SAME file (`join(<agentDir>, '.claude',
  'settings.local.json')`, five sites in the service) so the two modules excluded each other
  NOWHERE, not even inside one process. And `file-lock.ts` is process-local by construction — its
  own header says so — meaning the file that decides which plugins an agent loads had the WEAKEST
  of the three. A grep for the locks you already know about cannot find the one you do not.
- **The write-boundary detector went blind and reported CLEAN.** Migrating three sites from
  `saveJsonSafe` to `updateJson` dropped it from 3 out-of-root findings to **ZERO**. The writes had
  not stopped; `WRITE_VERBS` is a list of verb NAMES and nobody had told it the new one. Its own
  non-vacuity assertion (`byClass.constant > 0`) is the ONLY reason this was noticed — the exact
  case that assertion exists for, arriving from a direction nobody predicted. `updateJson` is now in
  the list, `lib/json-io.ts` is in `KNOWN_INDIRECT_WRITERS` (it is the sanctioned writer and every
  path it touches is a parameter, so no textual scan can ever see it), and the stale `mkdir`
  allowlist line was RE-HOMED rather than deleted — dropping it would have made a real write
  invisible to both lists at once.

### And one defect in this card's own sibling

TIV1RHMW was filed `column: backburner` while carrying `blocked-by: [RYFP030K]` — a rule violation
(non-empty `blocked-by` ⟺ `column: blocked`). Both corpus linters caught it independently on the
next full-suite run. Corrected to `blocked` + `pre-block-column: backburner`. Run your own gate on
your own artifact.

---

USER-mandated (2026-08-01): a **universal editor for BOTH `~/.claude/settings.json` and
`settings.local.json`**, exposed as an ai-maestro API, with **every writer across ai-maestro, its
scripts and its plugins GATED** by it. Source material: AgentlensPro's `safe_config_edit.py`
(issue #105), downloaded to gitignored `downloads_dev/agentlenspro-safe-config/` and studied.

## MEASURED — what ai-maestro has today (this is the "is it an improvement?" answer)

The guarantees already exist and are **SPLIT ACROSS TWO MODULES**, so whether a writer is protected
depends on which file it happens to live in. That is the core defect, independent of AgentlensPro:

| guarantee | today | where |
|---|---|---|
| refuse-unparseable · refuse non-object · atomic tmp+rename | ✓ | `lib/json-io.ts` |
| in-process per-file queue · cross-process `mkdir` lock · stale-break | ✓ | `withSettingsLock`, **private to** `services/element-management-service.ts:442` |
| fsync · kept backup · concurrent-modification check · staged re-read · post-commit audit · bounded retries | ✗ | — |

**Proof of the split:** the marketplaces route hardened last night (TRDD-ZT3P02PO) got
`saveJsonSafe` and **zero** `withSettingsLock`. 33 `saveJsonSafe` call sites across 6 files.

So: ours is **better** than AgentlensPro on locking (theirs has no in-process queue — a Node server
needs one), and **worse** on fsync/backup/audit/concurrent-mod.

## VERDICT (fable-advisor, consulted per advisor-rules — >3 files, architectural)

**(c)-plus: port into `lib/json-io.ts` and add ONE new primitive `updateJson(path, mutator)`.
Reject shelling out to Python outright. Verify-diff is NOT mandatory.**

Four findings that changed the plan, each of which I had wrong or missing:

1. **Shelling out to their Python is worse than I framed it.** Their ops grammar (`apply_ops`,
   py:201-300) has **no root-path `set`**, so it cannot express whole-object replace — option (a)
   inherits the entire 33-site ops refactor ANYWAY, *plus* `python3`-per-write on a fleet-wide hot
   path, *plus* a second write path, which is the exact disease
   `one-json-io-implementation.test.ts` exists to forbid.
2. **The current API structurally cannot do the concurrent-modification check.** Their gate 4
   (py:414) compares against the snapshot taken at READ time — and `loadJsonSafe` → `saveJsonSafe`
   are two separate calls, so the baseline never travels. Plain (c) would silently drop the one
   gate that prevents **lost updates**, and our 33 async read-modify-write sites can already
   interleave IN-PROCESS today. Hence `updateJson(path, mutator)`: read-under-lock → caller mutates
   → snapshot-compare → fsync-tmp → rename → bounded retry.
3. **Their gate-5 auto-rollback is a HAZARD in our context, not a safety.** The `claude` CLI writes
   `settings.json` WITHOUT our lock, so `os.replace(backup, target)` (py:438) after an audit
   mismatch would **destroy a non-participant's legitimate write**. Port the audit as
   detect-and-log-loudly; **never** auto-rollback.
4. **The installer runs with the server DOWN**, so the CLI wrapper must invoke the core through a
   shipped node entrypoint, **not** HTTP. The shared sidecar lock is what makes both paths safe.

## ⚠ "100% safety" is NOT achievable — state the real ceiling

The USER asked for 100%. It cannot be honestly claimed by us or by AgentlensPro, for two reasons:
the **`claude` CLI is a non-participating writer** (it takes no lock of ours), and an irreducible
**TOCTOU window** remains between the byte-compare and the `rename`.

**The honest ceiling, which IS achievable and is what this card delivers:** no torn writes; no
rebuild-from-corrupt; no lost updates *among participating writers*; every mutation recoverable from
a kept backup. Any doc or API description must say exactly this and must not say "100%".

## Plan

1. Extend `lib/json-io.ts`: fsync the tmp before rename · timestamped backup with a pruning cap ·
   O_EXCL sidecar lock + **reentrant** in-process per-path mutex · bounded retries · `updateJson`.
2. Migrate the 33 RMW sites to `updateJson`. **Keep `saveJsonSafe` for R51 compensations only** — an
   undo writing `c.prior` must NOT get a staleness baseline, because the file legitimately changed.
3. Layering: the core in `lib/` is the authority; the server calls it **in-process** (never its own
   API); the API route and `aimaestro-settings.sh` are transports (Plugin Abstraction Principle —
   plugins never call the API directly).
4. Extend the governance ratchet to forbid ANY other writer of `settings*.json` (tonight's
   `user-settings-has-two-writers.test.ts` is the seed; widen it to `settings.local.json`).

## Verification

- **The deadlock risk is the first test to write**, per the advisor: two concurrent `updateJson` on
  one path. Today's code LOSES one write — so that test must red before the fix and pass after,
  which also proves the reentrancy of nested pipelines that RMW the same file twice.
- Neuters, each named: drop the snapshot-compare → the lost-update test reds; drop the fsync/rename
  → torn-write test reds; make the audit auto-rollback → the non-participant-write test reds.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above 325 files / 4614 passed.

## Estimated risk

**MED-HIGH.** 33 call sites in the server's most safety-critical write path, plus a new lock
primitive. The deadlock risk is real and is why its test comes first.

## Acceptance

- [x] `updateJson(path, mutator)` with reentrant lock, snapshot-compare, fsync, backup, retries
- [x] the 33 RMW sites migrated; `saveJsonSafe` retained ONLY for R51 compensations, with the reason
      — **32 of 32 done** (one of the 33 grep hits is a comment), `2c47ab89` closing the last 21.
      `saveJsonSafe` is no longer IMPORTED by the service at all: it is re-exported for other
      modules, and re-adding it to that import is now the signal that a call site has regressed to a
      two-call read-then-write. **Its retention clause found ZERO takers here** — the one true
      compensation became `restoreRawSnapshot`, the primitive written for a snapshot replay, which
      also let it DELETE rather than write `{}` over a path that held no file.
      Decided per site by reading the enclosing gate: the grep heuristic's 6 flagged sites were 6
      false positives, and two undos that look like compensations are not (they rebuild key-by-key
      from a ledger so a concurrent edit survives the rollback, which is a read-modify-write).
- [x] audit is detect-and-log; auto-rollback explicitly NOT implemented, with the reason recorded
- [x] API route + `aimaestro-settings.sh` (node entrypoint, not HTTP — installer runs server-down) — `12e2ef97`, both transports over one shared `lib/settings-gate.ts`; CLI carries ZERO HTTP references (verified by grep)
- [x] governance ratchet forbids any other writer of `settings*.json` incl. `settings.local.json`
      — both halves land in `tests/governance/user-settings-has-two-writers.test.ts`; the
      `settings.local.json` allowlist is now exactly ONE entry, `lib/json-io.ts`. Neuter verified:
      removing the allowlist entry reds "no NEW file writes an agent settings.local.json directly"
      and names the offending file.
- [x] the ceiling is documented as the honest one, never "100%" — in `lib/json-io.ts`'s gate header.
      Re-state it verbatim in the API description when that lands; the box is not closed for the
      transport layer, only for the core
- [x] tests + neuters recorded by name; tsc 0 lines; suite at or above baseline
      — 11 tests, 5 neuters (above), tsc 0 lines, suite **326 files / 4623 passed / 2 skipped**
      (baseline was 325 / 4614 / 2; the 2 failures this run were the TIV1RHMW card defect, fixed)
- [x] report the adopted/declined set back on issue #105 — posted, comment `5153998963`. ADOPTED:
      refuse-unparseable, fsync, kept backup + prune, cross-process lock, concurrent-modification
      check, post-commit audit. DECLINED with reasons: auto-rollback on audit mismatch (we do not
      own the file — the `claude` CLI writes it unlocked, so a mismatch is more likely their
      legitimate write and restoring our backup would destroy it) and their lock path/mechanism
      (a FILE + `O_EXCL` vs our DIRECTORY + `mkdir`; two mechanisms exclude each other nowhere, so
      adopting theirs would have unprotected every un-migrated caller mid-migration).

## Approval log

- 2026-08-01T03:59:33+0200 — USER MANDATE. The USER directed the universal gated editor explicitly
  ("we need to make settings editing across all ai-maestro and its scripts / plugins gated by a safe
  tool like this one"). Authority: USER >= any required approver.
- 2026-08-02T01:38:00+0200 — CLOSED at 12/12. Every acceptance box ticked and each one verified
  first-hand, not taken on report: `tsc` 0 lines, full suite **331 files green** (exit 0), and the
  decisive measurement — **zero `saveJsonSafe` call sites remain in `app/`, `lib/`, `services/` or
  `scripts/`**, so `lib/json-io.ts` is now the sole writer of both settings files rather than merely
  the sanctioned one. Neuters recorded by name in `2c47ab89` and `9b6d4f0e`. `min-approval-
  requirement: none` and the card is a USER mandate, so no approval round-trip was owed.
