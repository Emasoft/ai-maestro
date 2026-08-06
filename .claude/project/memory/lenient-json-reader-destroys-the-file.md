---
name: lenient-json-reader-destroys-the-file
description: "my settings.json / registry / config got replaced by a nearly-empty object / a corrupt JSON file silently became {} / readJsonSafe returns null for both missing and unparseable / is this read-modify-w"
ocd: 2026-08-01
lmd: 2026-08-01
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: reliability-patterns
---

# lenient-json-reader-destroys-the-file


^ATOM-6P43-UR30 [desc:"lib/json-io.ts is the ONE owner of JSON read/write; a reader that answers {} to both absent and unreadable turns every read-modify-write into silent data loss", keywords: readJsonSafe_returns_null_for_both corrupt_config_replaced_with_empty_object settings_json_lost_its_keys is_this_read_modify_write_safe which_json_reader_should_I_use unreadable_is_not_absent, ocd: 2026-08-01, lmd: 2026-08-01]

**`lib/json-io.ts` is the single owner** of `readJson` / `loadJsonSafe` / `saveJsonSafe`
(`TRDD-CS25TA6W` consolidated four drifted copies into it). Two properties matter:

- **`readJson` DISTINGUISHES** `{ok:false, reason:'missing'}` from `{ok:false, reason:'unreadable'}`,
  and treats a JSON `null` / array / scalar as unreadable — `JSON.parse` succeeds for all of those,
  so a `Record<string, unknown>` return type is a LIE without the check.
- **`saveJsonSafe` REFUSES to overwrite a target it could not read**, and is atomic
  (`<path>.tmp.N` + rename). Two of the four old copies were neither.

**The defect class** (`TRDD-K71FV649`): a reader that answers `{}` to BOTH "absent" and
"unreadable" is a *vacuous verification* on the read side and *silent data loss* on the write side —
`await readJsonSafe(p) || {}` followed by a mutate-and-write REPLACES a corrupt-but-present file with
a minimal object built from nothing. Count the WRITES, not the reads: 21 of 21 `saveJsonSafe` call
sites were read-modify-writes fed by that same blind read, 4 of them on the user's own
`~/.claude/settings.json`.

**Consolidation is not coverage.** A 5th copy survived as a LOCAL function inside
`app/api/settings/marketplaces/route.ts` — module-level copies were what the sweep looked for. Its
`GET` use is harmless (read-only), and it feeds **five** `writeFile(SETTINGS_PATH, …)` sites. [^1]


^ATOM-D9FS-8V42 [desc:"json-io has THREE write kinds; pick by the write's MECHANICS, never by whether it sits in an undo", keywords: which_json-io_writer_do_I_use updateJson_vs_saveJsonSafe_vs_restoreRawSnapshot is_this_an_R51_compensation settings_write_primitive_choice do_I_need_mkdir_before_writing_settings, ocd: 2026-08-01, lmd: 2026-08-01]

`lib/json-io.ts` exposes THREE writes, and every settings mutation in the tree uses one of them —
there are ZERO remaining call sites of the old whole-object writer in `app/`, `lib/`, `services/`
or `scripts/`:

- **`updateJson(path, mutator, opts)`** — the DEFAULT. A locked read-modify-write: fsync, kept
  backup, staleness gate, post-commit audit. Everything that reads-then-writes takes this.
- **`restoreRawSnapshot(path, raw)`** — R51 compensations ONLY. Replays bytes captured BEFORE the
  forward path ran, so it must NOT parse and must NOT get a staleness baseline (`updateJson` would
  see the forward write as a foreign change and refuse the one caller whose job is to overwrite).
  `raw: null` DELETES — which is what an undo owes when the file did not exist beforehand.
- **`saveJsonSafe(path, data)`** — guarded whole-object write. Still exported for external callers;
  no production call sites remain. Re-importing it into a service is the signal a call site has
  regressed to a two-call read-then-write.

**PICK BY MECHANICS, NOT BY ROLE.** "Is it inside an `undo:`?" is the WRONG question and a grep
heuristic on `undo|compensat|c.prior|rollback` got 6 of 6 wrong. The right question is *does this
replay a PRE-CAPTURED SNAPSHOT?* Two undos here rebuild the settings key-by-key from a ledger —
deliberately, so a concurrent writer's edit survives the rollback — which makes them
read-modify-writes and `updateJson`'s job. [^2]


^ATOM-KXGA-N0VN [desc:"A test wrote the developer's real ~/.claude/settings.json because a new step's path argument DEFAULTED to it, and the tripwire that exists for exactly this was opt-in on 6 of 385 suites", keywords: a_test_wrote_my_real_settings.json tests_modified_my_global_claude_config suite_green_while_it_edited_settings.json default_argument_points_at_the_real_file guardRealUserSettings_did_not_fire opt-in_tripwire_covered_almost_no_suites containment_for_a_lane_that_writes_user_config, type: feedback, ocd: 2026-08-06, lmd: 2026-08-06]

A step added to the absorbed auto-update lane took `settingsPath` as a DEFAULTED parameter
(`= ~/.claude/settings.json`). Every absorbed-duty test drives the tick body, so the suite inherited
that default and rewrote all 257 of the user's marketplace entries — while reporting **35/35 GREEN**,
because nothing in that file asserts on the settings file. The write itself was well-formed (it went
through `lib/settings-gate::editSettings`, so atomic + locked + valid); the MECHANISM was the bug, and
a wrong value would have been just as invisible.

The fix: `settingsPath` is threaded through `AbsorbedDutyDeps` and injected at every call site.
**Any step in a lane that writes user config takes its path as a PARAMETER, never a default** — a
default is what silently promotes a unit test into a writer of live state. The tripwire half of the
story is its own atom (search: opt-in guard adoption rate).


^ATOM-24WY-9P6U [desc:"A guard is worth its ADOPTION RATE — an opt-in tripwire protected 6 of 385 suites and missed the only one that needed it, because nobody expects the write it exists to catch", keywords: my_guard_did_not_fire the_tripwire_never_caught_it opt-in_guard_covers_almost_nothing should_this_check_be_global_or_per-suite a_guard_nobody_remembered_to_add prove_a_guard_fires_instead_of_assuming_it, type: feedback, ocd: 2026-08-06, lmd: 2026-08-06]

`guardRealUserSettings` was the RIGHT guard — snapshot-compare, deliberately verb-agnostic so a
renamed write verb cannot blind it — and it still missed the incident it was built for, because it
was OPT-IN and only **6 of 385** suites called it.

That is not bad luck, it is the shape of the problem: **a guard against "a write nobody expected" is
useless precisely in the suites where nobody expected a write.** The suite that needed it was, by
construction, the one no one had thought to add it to. So for this class of guard the only adoption
rate that protects the NEXT unforeseen case is 100% — it belongs in `vitest.config` `setupFiles`, not
in a helper each author must remember.

And prove it fires rather than assuming: a probe appending ONE byte to the real file fails the suite
with `MODIFIED it (51541 → 51542 bytes)` while the probe's own assertion passes. The test passing
while the FILE guard fails the suite is the intended shape — a guard that has never fired is
indistinguishable from one that cannot.

## Notes and lessons learned

[^1]: [id:ATOM-08VJ-BFMH, status:valid, desc:"A guard flag set by a branch that never read the file makes a blind read reachable — count the writes and check what ELSE sets the flag", keywords:"is_the_destructive_write_even_reachable cleaned_flag_set_by_a_different_branch corrupt_file_plus_stale_cache consolidation_missed_a_local_copy my_change_made_an_old_bug_reachable", ocd:2026-08-01, lmd:2026-08-01] DO NOT clear a "was it a module-level copy?" sweep and call the defect class closed, BECAUSE the copy that survives is the one shaped differently — a LOCAL function inside a route file — and it can feed more write sites than all the module-level ones did (5 here, on the user's own `~/.claude/settings.json`). DO grep for the SHAPE (`readJsonSafe(...) || {}` feeding a write), not for the symbol. AND DO NOT reason "the blind read yields `{}`, so the mutation finds nothing and no write happens" — check what ELSE sets the write's guard: here `cleaned` is set by a `existsSync(cacheDir)` branch that never touched the settings file, so a corrupt settings.json PLUS a stale cache dir writes `{enabledPlugins:{}}` over everything the user had. Found while wiring an unrelated verdict into the same handler — and that wiring made the block MORE reachable (a mismatch now reaches it, where before only a hard failure did), which is what turns an old latent bug into an effect of your change.
[^2]: [id:ATOM-W13N-MPRZ, status:valid, desc:"migrating a call site to updateJson changes its FAILURE characteristics, which invalidates comments that reasoned from the old writer", keywords:"updateJson_can_throw_where_saveJsonSafe_could_not latent_compensation_comment_is_now_false gate_can_abort_after_migrating_the_writer no_mkdir_needed_before_updateJson", ocd:2026-08-01, lmd:2026-08-01] DO NOT migrate a call site to `updateJson` and leave the surrounding reasoning untouched, BECAUSE it can THROW where `saveJsonSafe` could not (a lost-update refusal, key loss, an unparseable target) — so every comment justifying a compensation as "latent, because the write is atomic and nothing can fail" becomes false, and a gate that could not abort now can. DO re-read the gate's comments and its undo trigger after the swap, and drop any `mkdir` you were about to add: the lock puts its lockdir beside the target, so `acquireLock` has already created the parent directory.

## See also

- [[aio-pipeline-rollback-transactions]] — the other half of the same session: a COMPENSATION reads
  and writes these same stores, so a verification wired to abort there reports a restored system as
  unrecoverable.
