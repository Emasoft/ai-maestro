---
name: pillar-tooling-scale-and-index
description: "greptrdd / trdd-doctor got slow or ran out of memory on a big corpus / the linter crashed with a heap error / do we need a database for the TRDD corpus / why is validating references so expensive / how do I add PRRD or SPEC support to the corpus reader / where is the pillar SQLite index and what are its safety rules"
ocd: 2026-07-28
lmd: 2026-07-28
metadata:
  node_type: memory
  type: project
  tier: component
---
The 3-pillars corpus tooling (`lib/pillar/*`, `lib/trdd-store.ts`, `lib/trdd-doctor.ts`,
`scripts/greptrdd.mjs`) was stateless and full-rescan until 2026-07-28. It is now built on a
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

RSS tracks corpus bytes at ~5.6-7×, so 100 000 cards (~1.17 GB) extrapolates to **~6.5 GB — past
Node's ~4 GB default old-space cap**. The failure at scale is a **heap crash at roughly
60-70 000 documents**, not a slow run. Super-linear wall time near the limit is GC pressure, i.e.
a symptom of the same thing rather than a second problem.

**2. The question was never "index or no index".** `lib/trdd-doctor.ts` ALREADY builds an index —
in RAM, from scratch, on every run (`byId`, `known`, `claimedBy` Maps). That in-memory index is
*why* `loadCorpus` holds every card with `raw` attached, so the 6.5 GB above **is** the index. The
real question is **rebuilt-every-run vs persisted-and-repaired-incrementally**.

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

## Notes and lessons learned

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
