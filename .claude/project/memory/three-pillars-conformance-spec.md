---
name: three-pillars-conformance-spec
description: "where is the 3-pillars (TRDD/PRRD/kanban) design actually decided / what is the arbiter when types/task.ts, the janitor rules, and GOVERNANCE-RULES disagree on a column name / does ai-maestro have a spec for the pillars / the IND vs DEP boundary test / what are the 17 columns authoritatively"
ocd: 2026-07-22
lmd: 2026-07-30
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: design-system
---
ai-maestro hosts the normative **3-pillars conformance SPEC** at
`design/specs/3-pillars-spec.md` (ai-maestro#85, USER-directed, `spec-version` semver). It is
the **ARBITER**: the janitor IND rules (`~/.claude/rules/{trdd-design-tasks,prrd-design-rules,universal-kanban}.md`),
the ai-maestro DEP overlays (`rules/aimaestro/aimaestro-*.md`), and the enforcement code
(`types/task.ts::DEFAULT_STATUSES`, `types/team.ts`) are all IMPLEMENTATIONS that conform to it.
On any disagreement (the 17-column vocabulary alone was duplicated across five artefacts with no
arbiter), the spec wins.

It is a CONFORMANCE CONTRACT, not a re-narration of rule prose — a prose copy would revive the
`design/rules-refactor/independent/` mirror retired in TRDD-TAFH4U0G. It pins: the 17-column
kanban vocabulary (`3P-KAN`), the TRDD id (`^[A-Z0-9]{8}$`, no UUID) / frontmatter / scope=path
contract (`3P-TRDD`), the PRRD golden/silver tier + `<letter><number>.<version>` identity model
(`3P-PRRD`), the **IND/DEP boundary test** (`3P-BND`: a statement is IND iff TRUE with the
ai-maestro harness removed — solo repo, one Claude, USER approves; DEP iff it presupposes the
harness — TITLEs, comm graph, min-approval-requirement, the server as notarizer), and the version
stamp + semver bump rules (`3P-VER`).

**Greppable** (USER: a spec is a lookup surface): every clause leads with a stable
`` `3P-<FAMILY>-NN` `` anchor + a bold key-phrase → `grep '3P-KAN'` = all kanban clauses,
`grep '3P-KAN-01'` = one. A `3P-GREP` cheat-sheet sits at the top. IDs are stable / never-reused /
append-only so a conformance check may CITE a clause id.

Enforced by `tests/unit/three-pillars-spec-conformance.test.ts` (asserts `types/task.ts`
DEFAULT_STATUSES == the spec's 17-column block, read FROM the spec) + the #83 overlay-filename
loop in `aimaestro-overlay-filename-contract.test.ts`. The spec lives in **`design/specs/`** — the
standard SPEC home in the doc-type taxonomy (PRRD `design/requirements/` → SPEC `design/specs/` →
TRDD `design/tasks/`, authority in that order) — not with the governance rules or the code; the
janitor + ai-maestro conformance checks read it from the repo path.

The design decisions this spec codifies (the pillar bodies + their `[^N]` lessons) live in the
janitor USER-scope hub [[ai-maestro-fleet-hub-governance-and-security]].

**Version history** (`3P-VER-01`: clauses ADDED = MINOR, ids append-only and never reused):
`1.1.1` → `1.2.0` (the `3P-IDX` + `3P-DAG` families) → **`1.3.0`** on 2026-07-30, adding three TRDD
clauses that came out of a real corpus defect: `3P-TRDD-09` **status-is-not-column** (a frontmatter
`status:` is a different field; only a column VALUE there is a defect), `3P-TRDD-10`
**one-state-claim** (a body state claim is a second source of truth — ERROR when it contradicts
`column:`, WARN when it duplicates it, and a DISAGREEING pair is never auto-resolved), `3P-TRDD-11`
**missing-column-fallback** (absent `column:` defaults to `todo` — the uncertainty law, so the
agent must evaluate the card before acting; USER, 2026-07-30). Adding clauses is a bump the JANITOR
consumes: `3P-CHK-03` obliges it to check its shipped IND bases against this spec **at the version
they declare**, and `tests/unit/pillar-store.test.ts` asserts the exact clause census — re-derive
that number with your own `grep -cE '^`3P-[A-Z]+-[0-9]{2}`'`, never by copying it out of a failure
message, or the count and the code agree by construction.[^4]

## See also

- [[trdd-conventions]] — the AUTHORING side of `3P-TRDD-09/10/11`: which of the three spellings of
  a card's state is legitimate, and what to label a body explanation instead of `**Status:**`.
- [[pillar-tooling-scale-and-index]] — the TOOLING that reads the corpus this spec defines:
  the measured 10⁵ budget, why the linter's in-RAM index was the memory wall, the
  documents→records model behind `lib/pillar/kinds.ts`, and the SQLite index's safety rules.

## Notes and lessons learned
[^1]: [id:ATOM-3PSP-0001, status:valid, keywords:"three_pillars_spec arbiter recall_before_authoring did_not_recall", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT author or re-derive the 3-pillars contract (the columns, the TRDD/PRRD schema) from
  scattered sources, BECAUSE a normative arbiter already exists at `design/specs/3-pillars-spec.md`
  and re-deriving risks minting a sixth drifting copy. DO recall this note and read the spec first
  (grep the `3P-<FAMILY>` you need). This note exists because the spec itself was authored WITHOUT
  first recalling the hub page's stored design decisions — the exact miss it now prevents.
[^2]: [id:ATOM-3PSP-0002, status:valid, keywords:"spec placement rules/aimaestro seeder workaround design/specs doc-type taxonomy", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT place a SPEC in `rules/aimaestro/` (nor tighten the rule-seeder to exclude it from
  seeding), BECAUSE that was a first-cut placement superseded 2026-07-22: the USER established the
  doc-type taxonomy where SPECs live in `design/specs/` (PRRD `design/requirements/` → SPEC
  `design/specs/` → TRDD `design/tasks/`, authority in that order, each with proposals/ + archived/).
  DO put a spec in `design/specs/`. SPECS and Claude Code RULE FILES are DIFFERENT things (USER,
  2026-07-22) — do not conflate. A SPEC DESCRIBES rule files (their content, paths, install
  protocols); the operational rule files themselves stay in their INSTALL folders (IND →
  `~/.claude/rules/` via janitor; DEP overlays `aimaestro-*.md` → `rules/aimaestro/`, seeded to
  workdirs) and do NOT move to `design/specs/`. Only the describing spec lives there.
[^4]: [id:ATOM-3PSP-0004, status:valid, keywords:"spec_clause_census_number test_asserts_clause_count copied_the_number_from_the_failure_output minor_bump_reddens_an_unrelated_test janitor_consumes_the_bump", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT copy the expected clause count out of a failing test's output when a MINOR bump adds
  clauses, BECAUSE the count and the spec would then agree by construction and the census would stop
  being an independent check. DO re-derive it with your own grep. Also: grep for EVERY test that
  READS this spec before bumping — a clause addition reddens the census test in
  `pillar-store.test.ts`, which no plan naming only the conformance test predicts.
[^3]: [id:ATOM-3PSP-0003, status:valid, keywords:"how_to_write_a_spec spec_from_summaries distiller_digest read_whole_rule_file one_rule_at_a_time spec_more_detailed_than_rule concise_is_style_not_omission", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT author a SPEC from summaries or a distiller agent's digest, BECAUSE a spec is MORE
  detailed than the rule file it captures, not a digest — a summary silently drops the atomic
  requirements the spec must pin. DO read the WHOLE source rule file yourself, ONE RULE AT A TIME,
  and capture EVERY rule + sub-rule as its own dry, greppable clause (USER, 2026-07-22). "Concise/
  dry/greppable" is the per-clause STYLE, never permission to omit content. Applied authoring
  [[three-pillars-conformance-spec]]'s siblings `design/specs/{governance-spec,scenario-tests-spec}.md`:
  killed a Sonnet summariser mid-flight, then read GOVERNANCE-RULES.md R1-R49 + SCENARIOS_TESTS_RULES.md
  in full, rule by rule (TRDD-R8LJJDBQ). This note exists because the first cut delegated the
  distillation to summaries — the exact miss it now prevents.

