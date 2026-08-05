---
name: model-context-window-classification
description: "the context percentage is wrong / a session shows 200K when the model is 1M / free space under-reported or over-reported / how does ai-maestro decide a model's context window / I added a new Claude model and the window is wrong / claude-opus-5 shows 200000"
ocd: 2026-08-04
lmd: 2026-08-04
metadata:
  node_type: memory
  type: project
  tier: component
  topic: architecture-and-runtime
  globs: [lib/context-limits.ts, rust-tools/aim-jsonl-reader/src/context.rs]
---

# model-context-window-classification

How ai-maestro decides whether a Claude model id gets the **200K** default or the **1M** extended
window. Two rules, in order:

1. the id contains the substring **`[1m]`** → 1M (any family can carry the tag);
2. the id matches a **natively-1M FAMILY** → 1M even untagged. Currently `sonnet-5` and `opus-5`,
   via `NATIVE_1M_FAMILY_RE = /(?:sonnet|opus)-5(?![0-9])/`.

Everything else — the whole 4.x line, bare `opus`/`sonnet`/`haiku` aliases, `claude-fable-5`,
unknown ids — is 200K.

**The rule is implemented TWICE and the two must agree:** `lib/context-limits.ts`
(`contextLimitForModel`) and `rust-tools/aim-jsonl-reader/src/context.rs`
(`context_limit_for_model`), which carries an explicit `MUST match lib/context-limits.ts` contract.
They resolve free space for the **same session**, so a one-sided edit makes them disagree.

## Adding a new model — the ONLY correct move

A new natively-1M model needs its family added to **both** implementations plus a test in each.
**Never relax the `(?![0-9])` boundary** to catch one: that guard is what stops a future
`claude-opus-50` (major v50) from inheriting a window it does not have.


^ATOM-QHWI-VJ9R [desc:"The rule lives TWICE: lib/context-limits.ts and the Rust mirror rust-tools/aim-jsonl-reader/src/context.rs, which carries an explicit MUST-match contract.", keywords: two_implementations_of_one_rule rust_mirror_must_match context_limit_for_model free_space_disagreement_between_reader_and_ui, type: project, ocd: 2026-08-04, lmd: 2026-08-04]

`contextLimitForModel` (TS) and `context_limit_for_model` (Rust) implement the SAME rule for the
SAME session's free space. The Rust file carries an explicit `MUST match lib/context-limits.ts`
contract in its header. A one-sided edit makes the JSONL reader and the dashboard disagree about
how much room a session has left. [^4]


^ATOM-OR3X-14PR [desc:"Natively-1M families are matched by NATIVE_1M_FAMILY_RE with a (?![0-9]) version boundary; the [1m] tag grants 1M to any family.", keywords: which_models_get_1M native_1m_family_regex version_boundary_guard claude-opus-50_must_stay_200k 1m_tag_substring, type: project, ocd: 2026-08-04, lmd: 2026-08-04]

Two rules, in order: (1) the lowercased id CONTAINS `[1m]` → 1M, on any family; (2) the id matches
`NATIVE_1M_FAMILY_RE = /(?:sonnet|opus)-5(?![0-9])/` → 1M even untagged. Everything else — the
whole 4.x line, bare `opus`/`sonnet`/`haiku`, `claude-fable-5`, unknown ids — is the 200K default.
The `(?![0-9])` guard is load-bearing: it is what stops a future `claude-opus-50` / `-55` (a
different major version) from inheriting a window it does not have, while keeping dated snapshots
like `claude-sonnet-5-20260630` at 1M. [^1] [^2]


^ATOM-1YN0-8FPW [desc:"A grep for hardcoded model ids in this repo is mostly .claude/chat_history transcripts and the rules TABLE itself — not code to update.", keywords: hardcoded_model_ids_across_the_repo should_I_update_old_model_ids chat_history_transcripts model_id_sweep_is_misleading, type: project, ocd: 2026-08-04, lmd: 2026-08-04]

Measured 2026-08-04: a sweep reporting "39 files / 154 hardcoded model ids" was dominated by
`.claude/chat_history/export-*.md` — TRANSCRIPTS, historical records that must never be edited —
plus `lib/context-limits.ts` itself, where old ids are legitimate mapping-table DATA. The genuine
targets of a model-id update are DEFAULTS and PINS, which are a small minority of any such count. [^3]

## Notes and lessons learned

[^1]: [id:ATOM-SI3Z-3UDU, status:valid, desc:"CC 2.1.219 made claude-opus-5 the default Opus; the family match was sonnet-5-only, so the bare id under-reported a 1M session as 200K.", keywords:"context_window_wrong_after_a_claude_code_upgrade new_model_silently_misclassified session_shows_200K_when_the_model_is_1M free_space_under-reported_5x", ocd:2026-08-04, lmd:2026-08-04] DO NOT assume the family list still covers every native-1M model after a Claude Code release, BECAUSE a new DEFAULT model can ship natively-1M under a BARE id and simply fall through to the 200K default with nothing failing. DO re-run `contextLimitForModel('<the-new-bare-id>')` on every CC upgrade. Measured 2026-08-04 (TRDD-9X2STNL2): CC 2.1.219 made `claude-opus-5` the default Opus with a native 1M window, the family match was `sonnet-5`-only, and the bare id returned 200000 — a 5x UNDER-report of free space.
[^2]: [id:ATOM-MQPS-QSWC, status:valid, desc:"The 1m tag short-circuits the family rule, so a test covering only the tagged id passes throughout the bug.", keywords:"test_passed_while_the_code_was_wrong tagged_id_hides_the_bare_id_gap which_input_shape_to_assert vacuous_model_window_test", ocd:2026-08-04, lmd:2026-08-04] DO NOT test a model-window rule with the `[1m]`-TAGGED id alone, BECAUSE the tag matches on rule 1 and returns 1M no matter what the family rule does — so the test stays green through a broken family match. DO assert the BARE id and the tagged id as separate cases. The tagged form is the one that appears most often in real JSONL, which is exactly why the common path stayed correct while the uncommon one was wrong and nothing failed.
[^3]: [id:ATOM-GZ6O-DGKR, status:valid, desc:"A raw model-id grep counts transcripts and mapping-table data as if they were pins to update.", keywords:"should_I_bulk_update_hardcoded_model_ids grep_count_is_misleading do_not_edit_chat_history_transcripts mapping_table_data_vs_a_pin", ocd:2026-08-04, lmd:2026-08-04] DO NOT bulk-update "hardcoded model ids" off a raw grep count, BECAUSE most hits are not code to change: transcripts under `.claude/chat_history/` are historical records that must never be edited, and `lib/context-limits.ts` is a rules TABLE where old ids are legitimate DATA. DO classify each hit as transcript / mapping-table-data / an actual default-or-pin before changing any of it.
[^4]: [id:ATOM-EGST-Y93Q, status:valid, desc:"09143c5a fixed TS+Rust but asserted TS-only; 3fc05688 added the Rust test. Each side's neuter reddens exactly one test.", keywords:"fix_landed_in_both_halves_but_the_test_only_in_one rust_mirror_can_drift_back unpinned_half_of_a_mirrored_rule assertion_on_one_side_only", ocd:2026-08-04, lmd:2026-08-04] DO NOT land a fix in both implementations while pinning it with a test in only ONE, BECAUSE the unpinned half then carries corrected behaviour with nothing holding it there and can drift back silently. DO add the assertion on both sides in the same change, and verify each side's neuter reddens exactly one test. Caught 2026-08-04: `09143c5a` fixed the TS and the Rust halves but asserted TS-only; `3fc05688` added the missing Rust case.
