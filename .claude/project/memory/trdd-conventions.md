---
name: trdd-conventions
description: "How to author a TRDD in this project: the trdd-id is now an 8-char UPPERCASE base36 id (NOT a UUID) — TRDD-K3QX9P2W style, case-insensitive lookup, create-time collision check. Also: where TRDDs live (design/tasks vs proposals/archived/refused), the canonical authoring snippet, and the zsh gotcha that the shell var must not be named UID. AND: where a TRDD's state lives — a card says `column: complete` while its body says `**Status:** Not started` / a drift detector reported `status='not-started'` but grep found no status field / may I write a Status line in the body / is `status:` a duplicate of `column:` / the linter reports 0 errors on a corpus I know is dirty / which spellings of the state field compete. AND: may I edit the body of an archived / complete / terminal TRDD — the IND §12 freeze and the NARROW janitor#139 carve-out (a VERIFIABLE contradiction may be removed, a line that adds context may not) / trddgrep validate baseline changed from 2 ERRORs to 1 / why is one BODY-STATE-CLAIM error permanent and not a backlog item / a terminal card has no acceptance boxes and the completion gate never caught it / why does a card with a spec-shaped bullet list never close / where must ## Acceptance checkboxes live."
ocd: 2026-06-23
lmd: 2026-08-20
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
