---
name: lenient-json-reader-destroys-the-file
description: "my settings.json / registry / config got replaced by a nearly-empty object / a corrupt JSON file silently became {} / readJsonSafe returns null for both missing and unparseable / is this read-modify-w"
ocd: 2026-08-01
lmd: 2026-08-01
metadata:
  node_type: memory
  type: project
  tier: aspect
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

## Notes and lessons learned

[^1]: [id:ATOM-08VJ-BFMH, status:valid, desc:"A guard flag set by a branch that never read the file makes a blind read reachable — count the writes and check what ELSE sets the flag", keywords:"is_the_destructive_write_even_reachable cleaned_flag_set_by_a_different_branch corrupt_file_plus_stale_cache consolidation_missed_a_local_copy my_change_made_an_old_bug_reachable", ocd:2026-08-01, lmd:2026-08-01] DO NOT clear a "was it a module-level copy?" sweep and call the defect class closed, BECAUSE the copy that survives is the one shaped differently — a LOCAL function inside a route file — and it can feed more write sites than all the module-level ones did (5 here, on the user's own `~/.claude/settings.json`). DO grep for the SHAPE (`readJsonSafe(...) || {}` feeding a write), not for the symbol. AND DO NOT reason "the blind read yields `{}`, so the mutation finds nothing and no write happens" — check what ELSE sets the write's guard: here `cleaned` is set by a `existsSync(cacheDir)` branch that never touched the settings file, so a corrupt settings.json PLUS a stale cache dir writes `{enabledPlugins:{}}` over everything the user had. Found while wiring an unrelated verdict into the same handler — and that wiring made the block MORE reachable (a mismatch now reaches it, where before only a hard failure did), which is what turns an old latent bug into an effect of your change.

## See also

- [[aio-pipeline-rollback-transactions]] — the other half of the same session: a COMPENSATION reads
  and writes these same stores, so a verification wired to abort there reports a restored system as
  unrecoverable.
