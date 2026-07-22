---
name: three-pillars-conformance-spec
description: "where is the 3-pillars (TRDD/PRRD/kanban) design actually decided / what is the arbiter when types/task.ts, the janitor rules, and GOVERNANCE-RULES disagree on a column name / does ai-maestro have a spec for the pillars / the IND vs DEP boundary test / what are the 17 columns authoritatively"
ocd: 2026-07-22
lmd: 2026-07-22
metadata:
  node_type: memory
  type: reference
  tier: component
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

