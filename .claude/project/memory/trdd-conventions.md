---
name: trdd-conventions
description: "How to author a TRDD in this project: the trdd-id is now an 8-char UPPERCASE base36 id (NOT a UUID) — TRDD-K3QX9P2W style, case-insensitive lookup, create-time collision check. Also: where TRDDs live (design/tasks vs proposals/archived/refused), the canonical authoring snippet, and the zsh gotcha that the shell var must not be named UID. AND: where a TRDD's state lives — a card says `column: complete` while its body says `**Status:** Not started` / a drift detector reported `status='not-started'` but grep found no status field / may I write a Status line in the body / is `status:` a duplicate of `column:` / the linter reports 0 errors on a corpus I know is dirty / which spellings of the state field compete."
ocd: 2026-06-23
lmd: 2026-07-30
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: design-system
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

Trivial in-session work uses a TaskCreate entry, not a TRDD. Every TaskCreate that references a TRDD carries its `TRDD-<id8>` id.

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

**Terminal cards are the sharp edge.** IND §12 freezes a terminal TRDD's body, so a
`column: complete` card carrying `**Status:** Not started` cannot be repaired without a governance
call — and that is exactly the pair that misled a detector for 35 days.[^3] Two of ours are
blocked on it (`C7A81642`, `7123D51A`), tracked on TRDD-FKGMNGJB behind a self-retiring gate
allowance.

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
