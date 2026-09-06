---
name: trdd-conventions
description: "How to author a TRDD in this project: the trdd-id is now an 8-char UPPERCASE base36 id (NOT a UUID) — TRDD-K3QX9P2W style, case-insensitive lookup, create-time collision check. Also: where TRDDs live (design/tasks vs proposals/archived/refused), the canonical authoring snippet, and the zsh gotcha that the shell var must not be named UID. AND: where a TRDD's state lives — a card says `column: complete` while its body says `**Status:** Not started` / a drift detector reported `status='not-started'` but grep found no status field / may I write a Status line in the body / is `status:` a duplicate of `column:` / the linter reports 0 errors on a corpus I know is dirty / which spellings of the state field compete. AND: may I edit the body of an archived / complete / terminal TRDD — the IND §12 freeze and the NARROW janitor#139 carve-out (a VERIFIABLE contradiction may be removed, a line that adds context may not) / trddgrep validate baseline changed from 2 ERRORs to 1 / why is one BODY-STATE-CLAIM error permanent and not a backlog item / a terminal card has no acceptance boxes and the completion gate never caught it / why does a card with a spec-shaped bullet list never close / where must ## Acceptance checkboxes live. AND: the heartbeat board count disagrees with a direct grep / a card is missing from the board / why is my TRDD not being counted / a legacy filename with no timestamp prefix is unparseable and silently dropped by every consumer that enumerates the corpus by filename / the filename is the parse key, not the frontmatter / my decomposition of the difference sums correctly but I only measured one term / is my arithmetic explanation actually measured / writing a headcount into a memory page that no test checks / state the mechanism instead of a headcount. AND: my batch logged FAIL edit but the deprecated field was already gone — trddgrep set removes approval-tier itself / a GRAPH-DANGLING-BLOCKER appeared right after I closed a root card — move clears blocked-by only on the card it moves, never on the cards that cite it."
ocd: 2026-06-23
lmd: 2026-09-06
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: design-system
publish-globally: false
---

TRDDs (Task Requirement Design Documents) are this project's git-tracked task specs, one `.md` per task under `design/`. The full spec is the global rule `~/.claude/rules/trdd-design-tasks.md` (v2 — `column:` kanban, NPT/EHT, the STATE block); approval tiers + the folder lifecycle are in `~/.claude/rules/trdd-approval-tiers.md`; project rules they cite live in `~/.claude/rules/prrd-design-rules.md`.

## The canonical authoring snippet — 8-char UPPERCASE base36 id (no UUID)

```bash
# The id is an 8-char UPPERCASE base36 string (A-Z + 0-9), e.g. K3QX9P2W — NOT a
# UUID.[^2] The while-loop is the create-time collision check (re-roll on a hit;
# 36^8 ≈ 2.8e12 so ~never). The var is TID, never UID — UID is readonly in zsh.[^1]
gen() { python3 -c "import random,string; print(''.join(random.choices(string.ascii_uppercase+string.digits,k=8)))"; }
# `find … | grep -q .`, never `ls <glob>`, and scan ALL FOUR zones — see [^3].
taken() { find design -name "TRDD-*-$1-*.md" 2>/dev/null | grep -q .; }
TID=$(gen); while taken "$TID"; do TID=$(gen); done
SHORT="$TID"                          # the 8-char id IS the canonical id (no UUID to slice)
TS=$(date +%Y%m%d_%H%M%S%z)          # filename timestamp (compact, Windows-safe)
ISO=$(date +%Y-%m-%dT%H:%M:%S%z)      # frontmatter created:/updated:
# File: design/tasks/TRDD-$TS-$SHORT-<slug>.md  (frontmatter trdd-id: $TID)
```

`TID` is the ratified ecosystem-canonical name (matches the `trdd-id:` frontmatter field; short; valid; not reserved in bash or zsh). The `<id8>` *filename* segment is the same 8-char id. Lookups are case-insensitive, but the id is always WRITTEN uppercase — macOS/Windows filenames are case-insensitive, so a lowercase letter could fold onto an existing id's file.

## Where a TRDD lives (folder = lifecycle)

- `design/tasks/` — OPEN work (authorized): every `column:` from `planned` through `dev`/`testing`/`blocked`/`failed`. A `failed` TRDD stays here (retryable), never archived.
- `design/proposals/` — authored, awaiting approval (`column: proposal`, Tier 1/2/3).
- `design/refused/` — proposals never approved.
- `design/archived/` — once-approved TRDDs now terminal (`completed`/`cancelled`/`superseded`).

Trivial in-session work is tracked in the session, not as a TRDD. Whatever tracks it names the `TRDD-<id8>` id when it references one.[^8]

## A TRDD states its pipeline position exactly ONCE — in `column:`

Three spellings compete for it, and only the first is legitimate:

| spelling | verdict |
|---|---|
| `column:` (frontmatter) | **the only home.** The v2 state machine; the kanban reads it. |
| `status:` (frontmatter) | a **DIFFERENT field** — it carries other aspects (the pillar specs use `status: normative`). NOT a retired duplicate of `column:` (USER ruling, 2026-07-30).[^4] Holding a *column value* there is the defect, not holding the field. |
| `**Status:**` / `**Column:**` / a line-initial `Status:` (BODY) | **v1-era residue.** The v1→v2 migration moved the field into frontmatter without deleting the original line, so ~98 cards across 13 corpora still carry one.[^3] |

Two `lib/trdd-doctor.ts` rules enforce it, and they do not overlap — two defects, two messages:

- **`STATUS-HOLDS-COLUMN-VALUE`** — a frontmatter `status:` whose VALUE is a pipeline state. Keyed
  on the value, never the field name.[^4]
- **`BODY-STATE-CLAIM`** (3P-TRDD-10) — a body state claim. **ERROR** when it contradicts
  `column:` (one card, two answers); **WARN** when it merely duplicates it. Only the AGREEING case
  is auto-repaired — which of two states is true is a judgement, and a fixer that picks one
  silently loses work. `bodyClaimAgreesWithColumn` is ONE predicate shared by the lint and the
  fixer.[^5] It compares the LEADING clause (real claims carry an explanation: `Not started —
  deferred until…`), accepts the `column` vocabulary plus `V1_STATUS_TO_COLUMN`, and adds exactly
  one inflection: `done` beside a terminal column.

**Authoring rule:** never write a state line in the body. If the body must explain *why* the card
sits where it does, label the explanation for what it is — `**Deferred until:**`,
`**Waiting on:**`, `**Blocked by:**`, `**Coverage:**`, `**Scope:**` — never `**Status:**`.

**Terminal cards are the sharp edge, and there is now a NARROW carve-out.** IND §12 freezes a
terminal TRDD's body — that is exactly the pair that misled a detector for 35 days.[^3] The
governance call was routed to the janitor (`ai-maestro-janitor#139`) and **RULED 2026-08-05**
(their `c80945ee`):

> a body line that **VERIFIABLY contradicts** the terminal `column:` may be removed, *"because
> deleting a false claim ABOUT history is not rewriting history"* — authorising removal of **ONLY a
> machine-verifiable contradiction, never a line that merely disagrees in wording, adds context, or
> cannot be mechanically proven false."*

**Read the exclusion clause, not just the permission — it is what decides most cases.** Applied to
our two blocked cards it split them, which is why the gate allowance in
`tests/unit/trdd-doctor.test.ts` **shrank 2 → 1 rather than being deleted**:

- `C7A81642` — `**Status:** Not started` beside `column: complete`. `not-started` is in the
  vocabulary and maps to `backburner`, so a machine PROVES the contradiction. **Repaired.**
- `7123D51A` — `**Status:** Implemented 2026-04-20 (…) Derived tasks #241/#242/#243 unblocked.`
  **Permanently excluded**, by the clause twice over: it ADDS CONTEXT and CANNOT be mechanically
  proven false — it is TRUE, merely unparseable, because "Implemented" names an ACTION that can
  predate the column and a date follows the verb. Clearing it would mean deleting a true line from
  a frozen card, or teaching the predicate to accept `implemented`, which this rule deliberately
  refuses. It is a permanent exclusion, **not a backlog item**.

So `trddgrep validate` reports **1** ERROR, not the 2 that were called "the baseline" for days.
TRDD-FKGMNGJB is closed and archived.[^7]


^ATOM-8FVL-IV1A [desc:"A terminal-column card with zero acceptance checkboxes makes the completion gate vacuous — every box in an empty file is trivially checked; boxes must live under Acceptance", keywords: acceptance_gate_vacuous_no_checkboxes terminal_column_zero_boxes_always_passes card_can_never_close_spec_bullets_counted_as_boxes completion_gate_needs_at_least_one_box where_must_acceptance_boxes_live, ocd: 2026-08-16, lmd: 2026-08-16]

A terminal-column card with NO acceptance checkboxes at all makes the completion gate (verdict G20260731: every box checked before complete/published/live) vacuous — "every box in the file is checked" is trivially true of a file with zero boxes. Measured 2026-08-16: 51 open cards had no checkboxes under ## Acceptance. Fixed in fd5fc4ee: 291 unchecked boxes added, 0 pre-ticked (adding boxes never asserts a check ran). Boxes MUST live under a ## Acceptance heading and nowhere else in the body — a spec-shaped ## bullet list elsewhere gets counted by the naive box-count and can make a card permanently unclosable.


^ATOM-KBQ6-H6Q5 [desc: "Parking a card (blocked, blocked-by, future review-after, hub-blocked/fleet-ask): it MUST carry blocker-probe + blocker-holds-if (+ canary for match:) or trddgrep validate flags BLOCKED-WITHOUT-PROBE", keywords: blocker-probe blocker-holds-if blocker-probe-canary BLOCKED-WITHOUT-PROBE BLOCKER-PROBE-NO-CANARY BLOCKER-PROBE-BAD-PREDICATE parked_card_stale_blocker blocked-by_rots review-after_probe how_do_I_park_a_TRDD stale_blocker_detected_by_machine not-match_success_sentinel fail-open_match PROBE_GATE_SINCE trddgrep_validate_blocked_card_warning, ocd: 2026-08-27, lmd: 2026-08-27]

A PARKED card must carry a runnable blocker probe. "Parked" = `column: blocked`, a non-empty `blocked-by:`, a FUTURE `review-after:`, or a `hub-blocked` / `fleet-ask` label. Three optional-elsewhere, mandatory-when-parked frontmatter fields, one line each:

```yaml
blocker-probe:        bash /path/to/emitter.sh   # argv, no shell
blocker-holds-if:     match:ACTION DUE   # exit-0|exit-nonzero|match:<re>|not-match:<re>
blocker-probe-canary: match:cookie/session   # required with match:
```

The blocker STILL holds when the predicate is true. Prefer `not-match:` on a SUCCESS sentinel (fail-closed: no output ⇒ still blocked); use `match:` only on an aggregate FAILURE sentinel every failure branch feeds, and declare the canary (a string HEALTHY output always contains) — else a timeout, a missing script or a drifted emitter all read as "cleared". Take every needle from the EMITTER'S SOURCE (`grep -nE '<needle>' <emitter>` non-zero = the source positive control); a regex tested against a string you typed is degenerate. Enforced by `trddgrep validate`: `BLOCKED-WITHOUT-PROBE` (error when the card was touched on/after 2026-08-27, warn before — `PROBE_GATE_SINCE` in `lib/trdd-doctor.ts`), `BLOCKER-PROBE-BAD-PREDICATE`, `BLOCKER-PROBE-NO-CANARY`. The janitor's `stale-blocker` detector runs the probes (three verdicts; could-not-run is never "cleared"). Why: a blocker stored as a VALUE rots silently (measured 4-in-5 stale); as a PREDICATE it is re-answerable forever. TRDD-CV5KDCB7.


^ATOM-XC3R-GAZ4 [desc: "a TRDD whose filename lacks the timestamp prefix is silently dropped by every consumer that enumerates the corpus by filename — the matcher keys on the FILENAME even when frontmatter carries a valid t", keywords: the_heartbeat_board_count_disagrees_with_a_direct_grep open_board_count_is_off_by_one my_TRDD_is_missing_from_the_board a_card_is_invisible_to_the_detectors legacy_TRDD_filename_with_no_timestamp_prefix why_is_my_card_not_being_counted the_filename_is_the_parse_key_not_the_frontmatter _TRDD_ID_RE_does_not_match_my_file a_net_difference_of_one_from_two_opposite_mechanisms renaming_a_TRDD_file_breaks_its_citations the_board_count_and_a_grep_answer_different_questions a_card_with_a_valid_trdd-id_still_does_not_appear, trdd: TRDD-UAP7ZEJL, ocd: 2026-09-05, lmd: 2026-09-05]
**A TRDD filename is the parse key, not its frontmatter.** The janitor's `_TRDD_ID_RE` accepts
only `TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md` or a 36-char UUID. The pre-2026 legacy shape
`TRDD-<8hex>-<slug>.md` matches neither, so such a card is **silently dropped** by every consumer
that enumerates the corpus BY FILENAME — the board count and the filename-keyed detectors. It
does not error and it does not warn; it is simply absent, which is why the symptom surfaces as an
arithmetic disagreement rather than a failure. (Stated as the MECHANISM deliberately: a headcount
of affected detectors goes stale the moment one is added, and cannot be checked by any test.)

Both cards found this way carried a perfectly valid `trdd-id:` in frontmatter, so the id was
available the whole time; the matcher reads the filename regardless. Fixing it at the data
(rename to spec shape, uppercasing the id) is a rename PLUS every citing reference — check
`design/specs/`, `docs/`, and each card's own `**Filename:**` line before renaming.

**The two counts answer DIFFERENT QUESTIONS, which is the durable half.** The heartbeat reads
several scope roots (PROJECT `design/`, plus LOCAL and USER design trees); a
`design/tasks/*.md` grep reads exactly one. So the two are never expected to agree, and their
difference is a COMPOSITE of at least two mechanisms pointing in OPPOSITE directions — filename
drops subtract, extra scopes add. **A small net difference is not evidence of a small single
cause**: decompose it before naming one, and measure each term rather than picking terms that
sum to the observed gap.[^9]


^ATOM-JPDJ-77A3 [desc: "two trddgrep write-verb behaviours that are NOT in its help text: set min-approval-requirement removes the retired approval-tier line itself, and move clears blocked-by only on the card it moves — eve", keywords: trddgrep_edit_failed_line=_empty_after_set my_batch_logged_FAIL_edit_but_the_field_was_already_gone approval-tier_line_vanished_after_trddgrep_set GRAPH-DANGLING-BLOCKER_appeared_right_after_I_closed_a_card blocked-by_still_names_a_card_that_is_complete trddgrep_move_did_not_clear_the_other_card's_blocked-by a_card_I_archived_is_still_cited_as_a_blocker does_trddgrep_set_remove_the_deprecated_field migrating_approval-tier_to_min-approval-requirement after_closing_a_root_blocker_validate_got_a_new_error which_cards_cite_the_card_I_just_moved stale_blocker_after_move, ocd: 2026-09-05, lmd: 2026-09-05]
**Two write-verb behaviours you learn only by running them, measured 2026-09-05 on 80 + 1 cards.**

`trddgrep set <id> min-approval-requirement <rung> --no-bump` on a card that still carries the
retired `approval-tier:` line **deletes that line as part of the same write** — the verb enforces
"a file carries exactly one of the two fields" itself. A batch that follows it with a separate
`edit --replace ""` to remove the old line finds nothing at that line number and logs a failure
for every card; **76 "FAIL edit" lines were nothing of the kind**. Positive-control the outcome
(0 `approval-tier` lines, new field present), never the loop's own exit codes.

`trddgrep move <id> <column>` clears `blocked-by:` **on the card being moved** when its blockers
are terminal. It does NOT visit the cards that cite the moved card. So closing a root blocker
leaves every dependant still naming it, and the next `validate` mints a `GRAPH-DANGLING-BLOCKER`
error one commit later. After any move to a terminal column, run `trddgrep unblocks <id>` (or
`grep -l "blocked-by:.*<id>" design/*/*.md`) and `trddgrep set <dep> blocked-by "[...]" --no-bump`
each citing card in the same commit. [^10]


^ATOM-5A0N-945A [desc: "trddgrep new --body '<one string>' writes the whole body as ONE line, so checkboxes typed inline are prose and the card has NO checklist — move to complete then refuses with 'has NO acceptance checkli", keywords: X_has_NO_acceptance_checklist_so_archiving_it_would_record_a_completion_that_proves_nothing trddgrep_move_refused_no_checklist card_boxes_are_on_one_line trddgrep_new_--body_one_line checkboxes_inline_not_a_checklist 0_boxes_on_a_card_I_wrote_with_boxes how_to_write_a_multi-line_TRDD_body_with_trddgrep trddgrep_edit_--replace_multi-line check-box_says_no_such_box acceptance_section_missing_after_trddgrep_new move_exit_2_checklist, trdd: TRDD-X9VLHBFZ, ocd: 2026-09-05, lmd: 2026-09-05]

`trddgrep new --title … --body "…"` stores the body verbatim as a single paragraph: `- [ ]` items typed into that string land on ONE line and are prose, not a checklist, so `trddgrep check-box` finds no boxes and `trddgrep move <id> complete` refuses with "has NO acceptance checklist … archiving it as 'complete' would record a completion that proves nothing" (exit 2). Hit twice on 2026-09-05 (one card fixed early in the session; X9VLHBFZ caught only at close time, after a commit whose subject already said "close"). DO write the body in a file and rewrite it with `trddgrep edit <id> --at-line <body-line> --expect "$(sed -n <n>p "$F")" --replace "$(cat body.txt)"` — `--replace` accepts embedded newlines — with a `## Acceptance` heading and one `- [ ]` per line; then `grep -cE '^- \[ \]'` before believing the card has boxes.


^ATOM-93XK-Z7FU [desc: "find -iname 'TRDD-*_*-<ID>-*' (and the [0-9]* form) also matches a SUCCESSOR card whose slug says successor-of-<id>, and head -1 returns whichever sorts first — anchor the id on the exact-length YYYYM", keywords: find_head_-1_picked_the_wrong_card successor_card_matched_my_id_glob card_reads_complete_but_I_superseded_it superseded-by_missing_after_my_move wrong_file_staged_for_a_card git_add_picked_the_successor_file iname_case-insensitive_slug_match [0-9]*_is_one_digit_then_anything glob_anchor_on_the_trdd_id exact-length_timestamp_anchor how_to_find_a_TRDD_file_by_id_safely blocker-probe_path_went_stale two_files_match_one_trdd_id, trdd: TRDD-U6AS2YWB, ocd: 2026-09-05, lmd: 2026-09-05]

A successor card minted "for" another carries the original id in its SLUG (`TRDD-20260905_102504+0200-MS3AD6NX-successor-of-39opyxq9-…`). `find design -iname "*39OPYXQ9*"`, `-iname "TRDD-*_*-39OPYXQ9-*"` and even `-iname "TRDD-[0-9]*_[0-9]*-39OPYXQ9-*"` ALL match it (`-iname` is case-insensitive and in a glob `[0-9]*` is ONE digit followed by anything), and `| head -1` returns whichever sorts first — measured 2026-09-05 three times: b2dd5269 staged the successor instead of the real card (the real edit stayed in the tree until 339cad77), a later measurement read the real card as "complete, no superseded-by", and the first U6AS2YWB blocker-probe carried the same hole. The only glob a slug mention cannot satisfy pins the id right after an exact-length timestamp: `TRDD-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9][+-][0-9][0-9][0-9][0-9]-<ID>-*` (spelled out; find has no `{8}`). Safer still: read `trdd-id:` from the candidate file and compare, or use `trddgrep show <id>`, which resolves by frontmatter. Never parse an id out of trddgrep's ANSI-coloured stdout either (`grep -oE "created [A-Z0-9]{8}"` matched nothing and left `$ID` empty — 7f9429a5).


^ATOM-2DJR-T0T3 [desc: "trdd-create.ts always appends its own Approval log — never include one in the body you pass it, or you get two", keywords: trddgrep_new lib/trdd-create.ts duplicate_Approval_log_heading two_approval_log_sections_on_a_card aimaestro-trdd.sh_create mandate_line_auto-appended card_mint_duplicates_heading do_not_pass_approval_log_to_create why_does_my_card_have_two_approval_logs TRDD-10J18FZX TRDD-66KNYSXY, ocd: 2026-09-05, lmd: 2026-09-05]

lib/trdd-create.ts (used by trddgrep new / aimaestro-trdd.sh create) ALWAYS appends its own ## Approval log heading plus a MANDATE line when minting a card. If the body you pass to it already contains an Approval log section, the resulting card carries TWO ## Approval log headings (observed on TRDD-10J18FZX and TRDD-66KNYSXY). Never include an Approval log in the body handed to a create verb — let the library write it.


^ATOM-O6YG-HTF5 [desc: "an owner-authenticated create mints created-by/mandated-by/approval-judge as user even with no real user approval", keywords: created-by_user mandated-by_user approval-judge_user owner-authenticated_create cached_CLI_session_no_AID_AUTH card_says_user_approved_but_nobody_did trddgrep_new_--author hub_session_mint USER_never_approved_this_card mandate_stamped_by_mistake, ocd: 2026-09-05, lmd: 2026-09-05]

An owner-authenticated TRDD create (a cached CLI session with no AID_AUTH resolved) stamps created-by, mandated-by and approval-judge as user. A hub-session mint therefore reads as if the human USER personally approved/mandated the card, when it was really an authenticated session acting on the owner's behalf. Correct the stamps at mint time, or mint with trddgrep new --author <session-name> instead of the default.


^ATOM-2M4I-0CC0 [desc: "mandated-by is the authority-rank enum (none/orchestrator/chief-of-staff/manager/user) — self is not a value", keywords: mandated-by_values authority_rank_vocabulary none_orchestrator_chief-of-staff_manager_user mandated-by_self_does_not_exist valid_mandated-by_enum what_values_can_mandated-by_hold grep_mandated-by_self_returns_nothing TRDD_field_vocabulary mandate_authority_ladder self-mandate_field_spelling, ocd: 2026-09-05, lmd: 2026-09-05]

mandated-by holds the AUTHORITY RANK vocabulary only: none, orchestrator, chief-of-staff, manager, user. self is NOT a value the create library ever writes — do not expect or grep for mandated-by: self.


^ATOM-M30Y-EHM4 [desc: "git diff --cached --name-only shows only the new path of a staged rename — pass --no-renames for both", keywords: git_diff_cached_name-only_rename commit_gate_refused_index_differs_on_rename staged_rename_shows_only_new_path git_diff_--no-renames rename_hides_old_path_from_diff gate_expects_both_old_and_new_path git_mv_missing_old_path_in_diff pre-commit_hook_rename_false_positive why_does_my_rename_gate_fail git_status_shows_R_for_rename, ocd: 2026-09-05, lmd: 2026-09-05]

git diff --cached --name-only lists ONLY the NEW path of a staged rename, not the old one. A gate or script that expects both the old and new path (e.g. to check a rename left no dangling reference) must pass --no-renames to see both paths as separate add/delete entries.


^ATOM-6XLD-BMIO [desc: "trddgrep append writes no dash/timestamp itself and bumps updated; rule 12 freeze binds only after the terminal move", keywords: approval_log_line_has_no_dash bare_line_in_approval_log updated_bumped_by_append can_I_edit_a_non-terminal_card trddgrep_append_does_not_prepend_anything caller_supplies_the_whole_approval_log_line no_--no-bump_flag_on_append rule_12_freeze_applies_only_after_terminal_transition live_auditing_card_body_edit_allowed editing_a_TRDD_approval_log_on_a_non-terminal_column append_verb_ISO_timestamp_missing, trdd: TRDD-OUAQARPL, ocd: 2026-09-06, lmd: 2026-09-06]
`trddgrep append <id> "## Approval log" "<text>"` (measured 2026-09-05 on TRDD-OUAQARPL, commits
cc37b395/22e9ddb1/7b58646a) prepends NOTHING — the caller supplies the WHOLE line, including the
`- ` list marker and the ISO timestamp: `- $(date +%Y-%m-%dT%H:%M:%S%z) — <text>`. A brief that
says "append the reason after whatever prefix the verb adds" is wrong; skip the dash/stamp and
you get a bare paragraph line with no bullet and no date. The verb also BUMPS `updated:` by
default (there is no separate `--no-bump` flag documented for `append` — pass the full record
you want, once).

Separately: rule 12 (terminal columns are frozen) only applies AFTER the transition that made a
column terminal. On a NON-terminal card — e.g. `column: live_auditing` — `trddgrep edit`/`append`
on the body is legal; the freeze is not a blanket "approval logs are append-only forever", it is
conditioned on the card's CURRENT column.

## See also
- [[three-pillars-conformance-spec]] — the ARBITER. The one-state-field contract above is pinned
  there as `3P-TRDD-09` (status is not column), `3P-TRDD-10` (one state claim) and `3P-TRDD-11`
  (the missing-column fallback), added in `spec-version: 1.3.0`.
- Global spec: `~/.claude/rules/trdd-design-tasks.md`, `trdd-approval-tiers.md`.
- Plugin alignment: the core plugin `ai-maestro-plugin` bundles a copy of the TRDD rule + TRDD skills (`ama-trdd-write`, `ama-trdd-transition`); its bundled `rules/trdd-design-tasks.md` still used the broken `UID` and its skills used `TRDD_UUID` — tracked in Emasoft/ai-maestro-plugin#15 to converge on `TID`.

## Notes and lessons learned
[^1]: [id:ATOM-TRDC-UID-READONLY-ZSH, status:valid, keywords:"UID_readonly_zsh_bad_math_expression shell_var_name_UID_bug never_name_var_UID authoring_snippet_TID_fix zsh_special_vars_STATUS_PATH_PWD", ocd:2026-06-23, lmd:2026-06-23] The global `trdd-design-tasks.md` (+ its v1 backup) shipped the authoring snippet with `UID=$(...)` / `SHORT=${UID:0:8}`. On macOS (zsh default) this fails every time — `UID` is readonly (the numeric user-id), so the assignment errors and `${UID:0:8}` is parsed as arithmetic → "bad math expression: operator expected". Agents kept re-discovering it mid-task. Fixed 2026-06-23: global rules standardized on `TID` + an inline anti-pattern note; ai-maestro project shell scripts audited clean (zero bare `UID`); plugin fix requested via ai-maestro-plugin#15. Lesson: the var name was the bug — never name a shell var `UID` (or other zsh specials: `STATUS`, `PATH`, `PWD`, `PID`); verify shell snippets in rules run under zsh, not just bash. (Historical: this snippet generated a UUID and sliced its first 8 chars; the UUID was dropped 2026-06-23 — see [^2] — but the "never name a var UID" lesson stands.)
[^3]: [id:ATOM-TRDC-0003, status:valid, keywords:"card_says_complete_but_body_says_not_started status_not_started_but_no_status_field third_spelling_of_a_field two_greps_agreed_absent linter_reported_zero_errors detector_read_the_body body_Status_line v1_migration_residue", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT conclude a field is absent because the spellings you happened to grep found nothing,
  BECAUSE `status:` / `column:` / `**Status:**` are three spellings of ONE concept and the janitor's
  drift finding — reported as a detector artifact by me, twice, once in a commit message — was
  sitting on line 19 as `**Status:** Not started`. DO enumerate the spellings first, then grep all
  of them (`grep -nE '^column:|^status:|^\*\*Status:\*\*'`). Corollary earned the same hour: "0
  errors" from a linter means "no rule looked" — our own corpus passed every gate while carrying 10
  such cards, because none of the 19 rules read bodies. A clean verdict is clean only of the
  classes the tool tests. Fixed by `BODY-STATE-CLAIM` (TRDD-FKGMNGJB).
[^4]: [id:ATOM-TRDC-0004, status:valid, keywords:"status_field_is_not_a_duplicate_of_column status_normative fixer_deleted_a_legitimate_field keyed_on_field_name_not_value autofix_data_loss", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT key a rule or a fixer on the FIELD NAME `status:`, BECAUSE `status:` is a different field
  carrying other aspects (USER ruling 2026-07-30: "status indicates other aspects, it is not a
  duplicate of column") — the first cut keyed on `fmHas('status')` and was marked `autofixable`, so
  `trdd:fix` would have DELETED a legitimate `status: normative` the moment one appeared, and its
  no-column branch rewrote `status: X` into `column: <mapped ?? 'todo'>`, inventing a state nobody
  chose. DO key on the VALUE being a recognised pipeline state (`isPipelineStateValue`).
[^5]: [id:ATOM-TRDC-0005, status:valid, keywords:"fixer_repaired_a_shape_the_lint_never_reported two_copies_of_one_predicate lint_and_autofix_diverged shared_predicate", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT let a lint and its `--fix` each carry their own copy of the same test, BECAUSE they drift
  and the drift is silent in the dangerous direction: `STATUS-HOLDS-COLUMN-VALUE`'s lint accepted
  only `VALID_COLUMNS` while its fixer also accepted `V1_STATUS_TO_COLUMN`, so `--fix` repaired all
  10 real `status: not-started` cards WITHOUT ever reporting them. DO export one predicate and call
  it from both (`isPipelineStateValue`, `bodyClaimAgreesWithColumn`).
[^6]: [id:ATOM-TRDC-0006, status:valid, keywords:"ls_glob_collision_check infinite_regenerate_loop nullglob unmatched_glob_lists_cwd id_collision_scan_all_zones", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT test whether an id is taken with `ls design/tasks/TRDD-*-"$TID"-*.md`, BECAUSE under
  `nullglob` an unmatched glob leaves `ls` with NO argument, so it lists the cwd and exits 0 — the
  `while` loop then regenerates forever — and scanning only `tasks/` misses an id already used by a
  card in `proposals/`, `archived/` or `refused/`. DO use `find design -name "TRDD-*-$TID-*.md" |
  grep -q .`, which the IND base mandates for exactly this reason. (The snippet above carried the
  `ls` form from its authoring on 2026-06-23 until this correction.)
[^2]: [id:ATOM-TRDC-ID-BASE36-NOT-UUID, status:valid, keywords:"trdd_id_8char_uppercase_base36 not_a_uuid_anymore collision_odds_at_1000_trdds uppercase_only_case_insensitive_filesystem size_id_to_population", ocd:2026-06-23, lmd:2026-06-23] TRDD ids used to be the first 8 hex of an RFC-4122 UUIDv4 (the FULL UUID in `trdd-id:`, the 8-hex prefix in the filename). The user found the long UUIDs hard to type/remember and pointed out 8 chars over the full 36-symbol alphabet (`A-Z`+`0-9`) is plenty: 36^8 ≈ 2.8e12 ⇒ ~1-in-5.6M collision odds at 1000 TRDDs, ~2M TRDDs for a coin-flip. Changed 2026-06-23: `trdd-id` IS now an 8-char UPPERCASE base36 id (no UUID at all). Uppercase-only because macOS/Windows filenames are case-insensitive — a lowercase letter could fold two distinct ids onto one file and silently overwrite. Collisions are handled by a create-time regenerate-on-hit `while ls` check, NOT the old "widen to 12 chars" idea (prevention beats post-hoc repair). Global rules updated together: `trdd-design-tasks.md`, `trdd-approval-tiers.md`, `commit-discipline.md`. Lesson: size an id to its population — a 36^8 space is collision-free for any realistic TRDD count, and short ids are the ones humans actually cite without typos.

[^7]: [id:ATOM-TRDC-0007, status:valid, keywords:"carve_out_permission_clause_vs_exclusion_clause ruling_landed_but_split_the_set acceptance_box_assumed_a_ruling_that_cleared_both allowance_shrank_instead_of_being_deleted permanent_exclusion_not_a_backlog_item re_check_an_external_blocker_before_re_reading_the_card", ocd:2026-08-05, lmd:2026-08-05]
  DO NOT read a governance carve-out as "the blocker cleared, so repair everything it was blocking",
  BECAUSE janitor#139's permission clause covers only a MACHINE-VERIFIABLE contradiction while its
  EXCLUSION clause ("merely disagrees in wording, adds context, or cannot be mechanically proven
  false") is the half that decided the second of our two cards — so a ruling can land in full and
  still SPLIT the set it was asked about. TRDD-FKGMNGJB's acceptance box said "repair the two cards,
  then DELETE the gate allowance"; that wording assumed a ruling clearing both and could not be
  satisfied as written. DO apply a carve-out item-by-item against its exclusion clause, shrink the
  allowance rather than deleting it when the set splits, and close the box as AMENDED with the
  divergence stated — never force a box whose premise the ruling falsified.
  Second half, cheaper and independently useful: the card had been parked since 2026-07-30 and last
  verified its blocker OPEN on 2026-08-02; on resume it had CLOSED hours earlier. DO re-check an
  EXTERNAL blocker before re-reading the card — a card can only ever report what was true when
  someone last looked, and for a GitHub blocker that is one `gh issue view` call.
[^8]: [id:ATOM-TRDC-0008, status:valid, keywords:"TaskCreate_tool_does_not_exist TodoWrite_missing_from_tool_list rule_names_a_tool_the_runtime_removed todo_tools_removed_2.1.233 CLAUDE_CODE_ENABLE_TODO_TOOLS prose_mandate_calls_absent_tool", ocd:2026-08-22, lmd:2026-08-22]
  DO NOT state a project rule in terms of the TOOL that happens to implement it, BECAUSE the tool
  is a runtime surface that upstream can withdraw and the rule then reads as an instruction to call
  something that does not exist. This line said "trivial in-session work uses a TaskCreate entry";
  Claude Code 2.1.233 removed TaskCreate/TaskGet/TaskUpdate/TaskList/TodoWrite by default on Opus
  4.8, Sonnet 5, Fable 5 and Mythos 5+ (restorable only with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`,
  which this fleet sets nowhere — measured 0 hits). DO name the OUTCOME the rule wants ("tracked in
  the session", "carries the id") and let each runtime supply its own mechanism. The falsifiable
  claim is "default-off on these models", not "impossible" — an env-flagged session refutes nothing.
  Corollary from the same sweep: 12 files matched the todo-tool names and only 2 were mandates —
  the rest are ai-maestro's OWN `TaskCreateForm`/`TaskKanbanBoard` React components, a
  `CachedTaskList` interface, `TaskCreated` event names, and transcript analysis that stays true of
  the transcripts it measured. Read every hit at its source line before counting it.
[^9]: [id: ATOM-ZU2K-STX4, status: valid, desc: "the first version of this atom asserted a two-term arithmetic decomposition that measurement refuted — it broke its own rule", keywords: "my_decomposition_sums_to_the_observed_gap_so_it_must_be_right I_named_two_causes_that_add_up_correctly a_net_difference_explained_by_terms_I_did_not_each_measure the_numbers_add_up_but_I_only_measured_one_term writing_a_headcount_into_a_memory_page_that_no_test_checks 4_of_5_detectors an_atom_that_violates_the_lesson_it_teaches an_inherited_number_written_as_established_fact how_many_detectors_are_affected is_my_arithmetic_explanation_actually_measured the_count_moved_from_52_to_54_so_my_theory_is_confirmed a_memory_page_has_no_test_behind_it stating_a_mechanism_instead_of_a_headcount", ocd: 2026-09-05, lmd: 2026-09-05] DO NOT write a decomposition of an observed difference into a durable note when you have measured only SOME of its terms, BECAUSE terms chosen to sum correctly are indistinguishable from terms that are true — this atom's own first version said the gap was "-2 + 1 = -1" on the strength of the -2 alone (the rename moved the count 52 to 54), and a later count found TWO todo cards outside `design/tasks`, not one, so 54 + 2 never reconstructed the heartbeat's 55. It also wrote "4 of the 5 detectors" as fact: the 5 was later confirmed by a census, the 4 never was. DO measure each term independently, or state the MECHANISM and leave the arithmetic open — a memory page has no test behind it, so a wrong number there is never caught, only inherited.
[^10]: [id: ATOM-N9Y2-EFZH, status: valid, desc: "a direct blocked→complete move does NOT clear the moved card own blocked-by either — validate then raises GRAPH-DANGLING-BLOCKER on a terminal card", keywords: "GRAPH-DANGLING-BLOCKER_on_a_card_I_just_moved_to_complete blocked-by_survived_the_move_to_complete trddgrep_move_blocked_to_complete_left_blocked-by dangling_blocker_on_a_terminal_card frozen_card_still_lists_a_blocker how_do_I_clear_blocked-by_on_a_complete_card trddgrep_set_blocked-by_empty_on_archived_card move_did_not_clear_my_own_blocked-by close_a_blocked_card_directly blocked_to_complete_skips_pre-block-column", ocd: 2026-09-05, lmd: 2026-09-05] DO NOT assume `trddgrep move <id> complete` on a `blocked` card clears that card's own `blocked-by:`, BECAUSE measured 2026-09-05 (DQVPODKW, blocked-by [1LFRP6GJ], moved blocked→complete after 1LFRP6GJ closed): the move renamed the file into archived/ and set the column but left `blocked-by: [1LFRP6GJ]` in place, so the next `trddgrep validate` raised GRAPH-DANGLING-BLOCKER on a now-terminal card — the earlier reading of this atom ("move clears blocked-by only on the card it moves") held for blocked→pre-block-column, not for a direct blocked→terminal move. DO run `trddgrep set <id> blocked-by '[]'` right after such a move (the tool accepts it on a terminal card and bumps `updated:`) and record why in the card's `## Approval log`, the one append-only field rule 12 leaves open.
