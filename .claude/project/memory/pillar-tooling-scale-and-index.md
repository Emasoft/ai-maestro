---
name: pillar-tooling-scale-and-index
description: "trddgrep / trdd-doctor got slow or ran out of memory on a big corpus / the linter crashed with a heap error / my streaming reader still uses all the memory / memory grows with every markdown file parsed / the server's memory keeps climbing and never comes back / do we need a database for the TRDD corpus / why is validating references so expensive / how do I add PRRD or SPEC support to the corpus reader / where is the pillar SQLite index and what are its safety rules / the index is SLOWER than the walk it replaced / opening the index costs more than the query / should the tool refuse or fall back when the index is broken or missing / can trddgrep's search be served by FTS5 / the cold index build takes forever and eats gigabytes / the warm query is just over the one-second budget / where does the time in a warm index query actually go / my stage timings do not add up to the total / the probe stats every file and I want to skip it"
ocd: 2026-07-28
lmd: 2026-07-30
metadata:
  node_type: memory
  type: project
  tier: component
---
The 3-pillars corpus tooling (`lib/pillar/*`, `lib/trdd-store.ts`, `lib/trdd-doctor.ts`,
`scripts/trddgrep.mjs`) was stateless and full-rescan until 2026-07-28. It is now built on a
shared seam with a SQLite index, for reasons that were MEASURED rather than argued — and the
measurements contradict the two things people assume.

**1. The wall is MEMORY, not time, and it arrives BELOW the stated 10⁵ target.** Measured with
`scripts/gen-trdd-fixture.mjs` (10 KB bodies, real frontmatter, real dependency edges):

| cards | corpus | wall | peak RSS |
|---|---|---|---|
| 298 (the live corpus) | 3.0 MB | 0.94 s | 114 MB |
| 1 000 | 10 MB | 1.61 s | 178 MB |
| 10 000 | 118 MB | 5.47 s | 820 MB |
| 50 000 | 586 MB | 37.6 s | **3.31 GB** |

**MEASURED at 10⁵ on 2026-07-29** (a real 100 000-card fixture, not extrapolated): the pre-fix lint
**CRASHED — exit 134, 4.45 GB peak RSS, dead at 23 s**. After the fix: **exit 0, 2.43 GB, 22.6 s**.
Note the shape: at scale this tool did not run slowly, it *died*. Super-linear wall time near the
limit is GC pressure — a symptom of the same thing, not a second problem.[^8]

**2. TWO independent causes, and the non-obvious one dominated.**

*(a)* `lib/trdd-doctor.ts` ALREADY built an index in RAM, from scratch, every run (`byId`, `known`,
`claimedBy` Maps), which is *why* `loadCorpus` held every card with `raw` AND `body` attached. So
the question was never "index or no index" — it is **rebuilt-every-run vs
persisted-and-repaired-incrementally**.

*(b)* **`gray-matter` keeps a MODULE-LEVEL cache keyed by each file's full text** and stores the
parsed file including `orig`, with nothing ever evicting it (`matter.cache[file.content] = file`,
4.0.3 `index.js:35-47`; it is skipped whenever ANY options object is passed). Memory therefore
tracked TOTAL BYTES EVER PARSED no matter how little the caller kept — **so streaming alone could
never have fixed this**, and (a) on its own would have been theatre. In a CLI the cost is bounded;
in the long-lived server it is an **unbounded leak**, and the same one-argument call was found in
three unrelated subsystems (marketplace scan, plugin builder, the ChangeClient converter chain).
One owner now: `lib/gray-matter-nocache.ts`, with a source-level guard, `TRDD-X6MJIMYS`.[^9]

Finding *(b)* took a refuted hypothesis first: identical frontmatter cost 456 MB with 10 KB bodies
and 104 MB with 1 KB bodies, which is the exact signature of V8 sliced strings — and deep-flattening
every frontmatter string moved it **−3%**.[^10]

**3. Reference validation is a JOIN, and that is what the index is for.** Every card resolves
`blocked-by` / `npt` / `eht` / `parent-trdd` / `superseded-by`; Phase 4 adds spec clauses and PRRD
rules, widening it to three corpora. `findTrdd()` re-readdirs all four zones **per call**, uncached,
so a cross-pillar lint written on the store's public API is **O(N² × refs)**. The doctor escapes
that only by building its own Map — the memory cost again. Therefore the index stores **resolved
reference EDGES, not just documents**; an index of documents alone leaves the join cost untouched.

**4. The three pillars have THREE document models** — verified on disk, and the reason
`lib/pillar/kinds.ts` is shaped the way it is:

| pillar | corpus | queryable unit | where the id lives |
|---|---|---|---|
| TRDD | many files across 4 zone dirs | one FILE | the **filename** |
| SPEC | 6 files in `design/specs/` | one CLAUSE, N per file | the **body**, line-anchored in backticks |
| PRRD | **ONE** file, `design/requirements/PRRD.md` | one BULLET LINE | the **line** (`- **G1.2** — …`) |

The generalization that fits all three: **a corpus is a set of DOCUMENTS, and each document yields
one or more RECORDS** (TRDD is the 1:1 case). A descriptor keyed on "zones + filename grammar" fits
exactly one of them.

**5. The index's SAFETY CHECK was its own scaling wall — the index LOST to the walk until that was
fixed.** `validate()` ran on EVERY `openIndex()`, and two of its seven checks are full scans of the
whole index: SQLite's `integrity_check` and the FTS parity form. Measured at 10⁴: the open cost
**666 ms** (integrity_check 367 ms + FTS parity 304 ms) in front of a query that costs **11 ms**.
So the accelerator was slower than the walk at every size tested. The fix is a SCHEDULE change, not
a weakening: the cheap structural checks (version stamp, `PRAGMA table_info` shape, orphan scans —
~3 ms, metadata-only) run on every open; the two full scans run at every state TRANSITION (create,
each migration step, any heal) and on demand. A read cannot corrupt what it does not write, so
verifying on every read was paying continuously to detect an event reads cannot cause. After:
warm `board` at 10⁴ went **1.03 s → 0.37 s**, against the walk's 1.12 s.[^11]

**6. The walk is NOT the outage it was assumed to be, so the degradation policy is FALL BACK, not
refuse.** Measured at 10⁵: `board --no-index` = **8.07 s / 1.02 GB / exit 0**; `validate` =
22.6 s / 2.43 GB. Both sit well inside the 4 GB ceiling. A tool that REFUSES when its cache is
broken fails exactly where falling back works, so trddgrep falls back LOUDLY (two stderr lines
naming the fault and which path answered) and `--no-index` skips the attempt outright. The trigger
that would flip this is measurable rather than arguable: a measured walk exceeding 4 GB or crossing
into minutes.[^12]

**7. SEARCH cannot be served by the index, BY DESIGN.** trddgrep's default search is a REGEX
search. FTS5 is token matching + bm25 — it cannot evaluate a regex, and its unicode61 tokenizer
splits `TRDD-BQC8NQSW` into whole tokens, so even a literal-only prefilter misses substrings. Search
stays walk-only; that is a documented CONTRACT in `lib/pillar/index-open.ts`, not an unfilled gap.
The ACCEPTANCE CRITERION exposed it, not the code.[^13]

**8. The FTS has NO reader, and it is what makes the cold build expensive.** Every `records_fts`
reference in production is a CREATE / INSERT / DELETE or the parity check that verifies it; the only
`MATCH` queries in the repo are in tests. Meanwhile the build ACCUMULATES every parsed row before
its transaction (`index-build.ts:91`) and each row retains the full `body` (`:114`) whose sole
consumer is the FTS insert (`:162`) — so a cold build's peak RSS is the SIZE OF THE CORPUS
(**2.36 GB at 10⁵**, flat once accumulation ends), spent entirely on a table nothing reads. That is
the same hoist-and-retain shape as *(2a)*, one layer up, and it survived because the comment
explains the hoist. Decision deferred to the phase that designs recall — `TRDD-7CHUK1AZ`.[^14]

**9. The WARM query is probe-bound, and the < 1 s budget at 10⁵ is MET (2026-07-30).** The index
removed the walk (8.07 s → ~1 s), and what was left over budget was the cost of *proving the cache
valid*, not of answering. Full warm decomposition, all in ONE process on a 10⁵ non-git corpus:
harness floor **210 ms** (node + `tsx` + trddgrep's own transpile — measure it as
`trddgrep help`, which reads nothing) · `openIndex` 25 · `syncIndex` **557** (of which
`listTrddFiles` 121, `identifyFiles` 302, its own diff 134) · `cardsFromIndex` 151 · everything
after the graph returns (`push(...spread)` + `new Map` + compute + render) **51**.

What bought the budget was not a cheaper staleness check. A layer-by-layer decomposition of
`identifyFiles` showed **43 ms of 302** building a git lookup key and probing two git maps that are
**EMPTY** on a non-git corpus — a fast path `gitRoot` returning `null` makes unreachable *by design*
(`freshness.ts:59`: every LOCAL-scope corpus is in that case). Hoisting `canBeGit = shas.size > 0`
out of the loop: `identifyFiles` 299-306 → **236-241 ms**, and all five graph verbs cross
**≥1.00 s → ≤0.98 s** in a stashed-BEFORE A/B. The probe still `stat`s every file; the guarantee is
untouched. Of the 236 ms remaining, **216 is the raw `statSync` syscall** — the floor is what the
guarantee costs, so that avenue is retired rather than deferred. The largest item left anywhere is
the 210 ms harness floor, which is a bundling / resident-process question, not `lib/pillar` work.[^15]

**Do NOT quote absolute timings across harnesses.** `bash scripts/with-node.sh` pays a 210 ms floor
where a bare probe pays ~101 ms; earlier cards used a 0.12 s boot. Two correct measurements ~0.1 s
apart before any work is done — comparing them manufactures changes that never happened.[^16]

**Where things are.** `lib/pillar/kinds.ts` (the three descriptors) · `lib/pillar/store.ts`
(fail-loud reader; the primary read is an ITERATOR because an array-returning read *is* the 6.5 GB)
· `lib/pillar/freshness.ts` (per-file identity; git consulted twice for the whole corpus, never
per file) · `lib/pillar/index-db.ts` (schema, migration ladder, validate, self-heal, heal ledger).
`lib/trdd-store.ts` is re-expressed on the seam with its public API frozen — the proof the
abstraction fits is that its tests pass unchanged.

## See also

- [[three-pillars-conformance-spec]] — the ARBITER for the pillar design itself; this page is
  about the tooling that reads the corpus, that one about what the corpus must BE.
- The `^kanban-index-is-a-cache` atom in [[ai-maestro-fleet-hub-governance-and-security]]
  (USER scope) states the same discipline for the board: a derived view is a buffer, never the
  authority — plan from the index, ACT from the TRDD. The SQLite index here is bound by exactly
  that rule, which is why its self-heal may delete the file: every row is reconstructible from
  markdown, so nothing authoritative can live only in it.

**The tool is `trddgrep`, installed to `~/.local/bin/` for every agent** (2026-07-30,
TRDD-217AYEOT). It was `greptrdd` — the two words backwards — and repo-local, and BOTH were
why the janitor's Claude reported "no access to the trddgrep tool at all" while the file sat
in this repo[^7]. USER naming law: every corpus tool is `<document type>grep` — `memgrep`,
`trddgrep`, `prrdgrep`, `specgrep`. ONE launcher (`scripts/pillar-cli`) dispatches on
`basename $0`, so there is one implementation and N entry points; a pillar name is installed
only when its `.mjs` exists (never a stub that refuses). `trddgrep env` prints
`mode=standalone` or `mode=agent <name>` with its reason — detection is read-only by
construction (an `existsSync` gate + a minimal parse, deliberately NOT `loadAgents()`, which
`mkdir`s the state dir before its own guard and SAVES a migration)[^8].

## Notes and lessons learned

[^7]: [id:ATOM-PTSI-0007, status:valid, keywords:"agent_cannot_find_the_tool tool_not_installed name_backwards greptrdd guessable_name discoverability", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT treat "the file exists in the repo" as evidence a tool is available, BECAUSE
  distribution and DISCOVERABILITY are independent failures and this tool had both: never
  copied to a bin dir, and named the two words backwards so no agent would guess it. DO name
  a corpus tool after the corpus (`<type>grep`) and install it, then ask an outside agent to
  find it.

[^8]: [id:ATOM-PTSI-0008, status:valid, keywords:"cwd_realpath registry_workdir_never_matches private_var symlinked_home path_resolve_is_lexical", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT compare `process.cwd()` against a recorded directory with `path.resolve`, BECAUSE
  cwd is ALWAYS a kernel realpath while the record is a string a human typed — so on macOS a
  workdir registered under `/var` or `/tmp` never matched a cwd of `/private/var`, and an
  agent standing in its own workdir was reported `standalone`. DO canonicalize both sides
  through `realpathSync.native` (lexical fallback for a since-deleted path).

[^1]: [id:ATOM-PTSI-0001, status:valid, keywords:"corpus_too_slow do_we_need_a_database index_already_in_ram loadCorpus rebuilt_every_run", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT ask "does this corpus need an index" without first grepping for the Maps, BECAUSE the
  linter already built one in RAM every run and that in-memory index WAS the multi-GB cost. DO ask
  "rebuilt every run, or persisted and repaired incrementally" instead.

[^2]: [id:ATOM-PTSI-0002, status:valid, keywords:"measure_peak_rss wall_time heap_crash below_target scale_budget", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT size a corpus tool by wall time alone, BECAUSE the wall here was MEMORY and it landed at
  ~60-70k documents — below the 10⁵ target — so the failure mode is a heap crash, not a slow run.
  DO measure peak RSS, and treat super-linear time near the limit as a symptom of it.

[^3]: [id:ATOM-PTSI-0003, status:valid, keywords:"reference_validation_join quadratic findTrdd_per_call edges_not_documents", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT index documents alone, BECAUSE validating a corpus is a JOIN and an uncached per-lookup
  scan makes a linear-looking tool O(N² × refs). DO store resolved reference EDGES so validation is
  one indexed join.

[^4]: [id:ATOM-PTSI-0004, status:valid, keywords:"three_document_models prrd_single_file spec_clause_in_body generalize_over_consumers", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT generalize a corpus reader over "zones + filename id grammar", BECAUSE that fits TRDD only
  — SPEC declares clause ids in the body and PRRD is ONE file whose records are bullet lines. DO
  model it as documents→records, and verify each consumer's shape on disk before generalizing.

[^5]: [id:ATOM-PTSI-0005, status:valid, keywords:"git_realpath symlink tmp var_folders fast_path_silently_dead", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT compare a caller's path against `git rev-parse --show-toplevel` output directly, BECAUSE
  git answers in REALPATH and on macOS `/tmp` and `/var/folders` are symlinks — the match fails and
  every file degrades to the stat fallback silently (the safe direction, so nobody notices). DO
  resolve the corpus root once and prefix-remap.

[^6]: [id:ATOM-PTSI-0006, status:valid, keywords:"git_ls_files_staged_sha dirty_working_tree missed_edit git_status_porcelain", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT identify a tracked file by `git ls-files -s` alone, BECAUSE that is the STAGED blob and an
  edited file would look unchanged, so the index skips a real edit — and a dirty tree is the normal
  working state. DO exclude `git status --porcelain` paths and fall back to size+mtime for them.

[^7]: [id:ATOM-PTSI-0007, status:valid, keywords:"memgrep_recall_name_column atom_not_a_page wikilink_target_wrong bidirectional_link", ocd:2026-07-28, lmd:2026-07-28]
  DO NOT treat a `memgrep recall` hit's name column as a PAGE name — this page first linked
  `[[kanban-index-is-a-cache]]`, which is an ATOM anchor inside a USER-scope page, so the wikilink
  pointed at a page that does not exist. BECAUSE recall ranks over atoms as well as pages, its name
  column may be either. DO resolve the owning FILE before wiring a link, and cite an atom by its
  `^anchor` within that page — otherwise the LINK LAW cannot be satisfied, since there is no far
  end to add the back-link to.

[^8]: [id:ATOM-PTSI-0008, status:valid, keywords:"extrapolated_memory_budget slow_versus_dead generate_the_real_fixture heap_crash_not_slow_run", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT close a scale question on an extrapolation — this page said "~6.5 GB, past the cap",
  and the measured truth was an OOM CRASH at 4.45 GB. BECAUSE extrapolation can be wrong in KIND,
  not just degree: "slow" and "dead" are different verdicts and only one of them is a bug report.
  DO generate the real 10⁵ fixture and run it. (Supersedes this page's original extrapolated
  table, which is kept above as the smaller-corpus curve because those points are still measured.)

[^9]: [id:ATOM-PTSI-0009, status:valid, keywords:"streaming_reader_still_uses_memory gray_matter_module_cache library_cache_defeats_streaming memory_grows_per_file_parsed server_memory_never_returns", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT conclude a reader's memory is fixed because YOUR code retains nothing, BECAUSE a
  dependency's module-level cache can retain every input behind you — gray-matter caches each
  parsed file keyed by its full text and never evicts, so a perfectly streaming reader still
  accumulated the whole corpus. DO grep the parser for `cache` before believing a streaming
  rewrite, and measure RETENTION (`--expose-gc` + `heapUsed`, or a heap-cap sweep) rather than
  peak RSS, which counts uncollected garbage and moved 57% while the live set barely did.

[^10]: [id:ATOM-PTSI-0010, status:valid, keywords:"plausible_cause_refuted v8_sliced_strings probe_before_fixing memory_correlation", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT fix the cause you INFERRED from a correlation — identical frontmatter costing 456 MB with
  10 KB bodies and 104 MB with 1 KB bodies is the exact signature of V8 sliced strings (a substring
  ≥ 13 chars pins its parent), and deep-flattening every string moved it −3%. BECAUSE a memory
  correlation usually has more than one plausible cause, and the plausible one was wrong here. DO
  run the candidate fix as a throwaway PROBE before editing any source.

[^11]: [id:ATOM-PTSI-0011, status:valid, keywords:"index_slower_than_the_walk validate_on_every_open integrity_check_cost open_costs_more_than_query safety_check_is_the_scaling_wall", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT run a whole-index verification on every OPEN, BECAUSE `integrity_check` and the FTS parity
  form are O(corpus) and cost 666 ms in front of an 11 ms query — the safety mechanism WAS the
  scaling wall, and the index lost to the walk at every size until it was split. DO schedule the
  full scans at state TRANSITIONS (create / migrate / heal) and keep only metadata-only checks on a
  read: a read cannot corrupt what it does not write.

[^12]: [id:ATOM-PTSI-0012, status:valid, keywords:"index_missing_should_it_refuse degrade_or_refuse accelerator_never_authority cache_broken_tool_dies", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT make a tool REFUSE when its index is unavailable, BECAUSE the premise that the fallback is
  an outage expires the moment the fallback is fixed — the walk measured 8.07 s / 1.02 GB at 10⁵,
  so refusing would break the tool exactly where falling back works. DO fall back LOUDLY (name the
  fault AND which path answered), keep an explicit skip flag, and write down the MEASURED trigger
  that would flip the decision.

[^13]: [id:ATOM-PTSI-0013, status:valid, keywords:"fts5_cannot_do_regex index_the_search substring_id_lookup tokenizer_splits_whole_tokens acceptance_criterion_exposed_it", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT plan to "serve the search from the index" without checking what the search IS — a REGEX
  search cannot be served by FTS5 (token matching + bm25), and unicode61 splits an id into whole
  tokens so even a literal prefilter misses substrings. BECAUSE the plan said "byte-identical
  results via FTS5", which is self-contradictory. DO state search as a walk-only CONTRACT in code
  rather than leaving it looking like an unfilled gap — and note it was the ACCEPTANCE CRITERION
  that caught this, not the implementation.

[^14]: [id:ATOM-PTSI-0014, status:valid, keywords:"write_only_table no_reader cold_build_holds_corpus parse_hoisted_out_of_transaction tests_prove_populated_not_read", ocd:2026-07-29, lmd:2026-07-29]
  DO NOT assume a structure the tests exercise is a structure something READS — the FTS tests assert
  it is POPULATED, and no production `MATCH`/`bm25` query exists, so it cost the entire cold build
  unnoticed. BECAUSE coverage cannot detect a missing CONSUMER. DO grep for a reader before paying
  to maintain a derived table — and note the related trap: hoisting a parse OUT of a transaction
  (sound, to avoid holding the write lock) does NOT excuse RETAINING the rows, which makes peak
  memory the corpus size; that identical shape had already been fixed one layer up.

[^15]: [id:ATOM-PTSI-0015, status:valid, keywords:"index_slower_than_expected warm_query_over_budget freshness_probe_dominates unreachable_fast_path_costs_per_file empty_git_map_lookup hoist_the_branch_check", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT optimise inside a branch before asking whether it can EVER be taken — 43 ms of a 302 ms
  probe was building git lookup keys for maps that are EMPTY on a non-git corpus, a path
  `gitRoot` returning null makes unreachable BY DESIGN. BECAUSE three sessions attacked this budget
  from the expensive side (a cheaper staleness check) while the win was a 6-line hoist that touches
  no guarantee. DO decompose the loop body layer by layer and check each layer's REACHABILITY, then
  A/B the removal — cumulative increments UNDERSTATE the win (predicted 43 ms, measured 63-68,
  because a skipped layer also skips the garbage it allocates).

[^16]: [id:ATOM-PTSI-0016, status:valid, keywords:"parts_do_not_sum missing_stage unaccounted_milliseconds two_probes_two_processes boot_floor_differs harness_not_code", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT name a cause for time that is "missing" between two measurements taken in two PROCESSES —
  I proposed one twice and was refuted twice for the same 120 ms. BECAUSE my probe's node boot read
  101 ms against the real CLI's 210 ms do-nothing floor, and `identifyFiles` read 432 ms in one
  process and 299-306 in another, so BOTH gaps (an outer 180-260 ms and an inner ~120 ms) were the
  instrument and vanished on one clock at 0.6% residual. DO instrument every stage AND the wall in
  the SAME process first — and prove the instrument (my excluded diagnostic layers summed to exactly
  the reported residual, to the millisecond, which is what made the figure believable).
