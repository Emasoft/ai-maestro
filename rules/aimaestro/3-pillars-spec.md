---
spec: 3-pillars
spec-version: 1.0.0
status: normative
created: 2026-07-22T07:54:21+0200
updated: 2026-07-22T07:54:21+0200
maintainer: ai-maestro
project-id: ai-maestro
requested-by: Emasoft/ai-maestro#85
implementations:
  - "janitor IND bases — ~/.claude/rules/{trdd-design-tasks,prrd-design-rules,universal-kanban}.md — canonical repo Emasoft/ai-maestro-janitor"
  - "ai-maestro DEP overlays — rules/aimaestro/aimaestro-*.md (this repo)"
  - "ai-maestro enforcement code — types/task.ts, types/team.ts, lib/kanban-field-authority.ts, docs/GOVERNANCE-RULES.md (this repo)"
---

# The 3-pillars conformance SPEC

**This file is the SPEC, not a rule.** It is the single, versioned, normative source
that the 3-pillars implementations conform to. The implementations (the janitor's IND
base rules, ai-maestro's DEP overlays, and ai-maestro's enforcement code) carry the
teaching prose and the executable logic; **this file carries the testable contract.**
On any disagreement between an implementation and this spec, **the spec is the arbiter.**

## Why this exists (the anti-drift discipline)

The pillars' invariants — the 17-column vocabulary above all — live duplicated across
at least five artefacts (`universal-kanban.md` prose, `types/task.ts::DEFAULT_STATUSES`,
`types/team.ts::DEFAULT_KANBAN_COLUMNS`, `docs/GOVERNANCE-RULES.md` R25, the DEP
overlays) with **no arbiter**. Two independently-authored halves of one system with no
shared normative source is how the IND/DEP split silently drifts (ai-maestro#83/#85,
janitor#73, DE9757LJ).

**This spec MUST NOT be a re-narration of the rule prose.** A spec that copies the rule
text is the exact `design/rules-refactor/independent/` mirror that ai-maestro RETIRED in
TRDD-TAFH4U0G — drift reborn under a new filename. This spec states **contract**:
authoritative values, MUST-assertions, and the boundary test. The prose stays in the
rules; this stays the thing they are checked against.

## Conformance & versioning

- `spec-version` is semver. Bump **MAJOR** when a `MUST` invariant changes (a column
  renamed/added/removed, the id grammar changed, a tier-authority rule changed);
  **MINOR** when an optional field or a non-breaking clarification is added; **PATCH**
  for wording only.
- An implementation MAY declare `conforms-to-spec: 3-pillars@<version>`. A declared
  version that does not match this file's `spec-version` is a **detectable** conformance
  failure — the whole point of the stamp is that a mismatch fails a test rather than
  surfacing months later as two agents disagreeing on a column name.
- **The bidirectional check loop:** ai-maestro CI asserts its own code + overlays
  conform (see "Conformance checks" below); the janitor asserts its shipped IND bases
  conform at the version they claim. #83 froze the overlay *filenames* the IND bases
  cite; this spec + the janitor check freeze the *content contract*. Together they close
  the loop in both directions.

## Pillar 1 — the kanban column vocabulary (17 columns)

The authoritative vocabulary, USER-ratified (TRDD-YUGDER9D / GOVERNANCE-RULES R25) —
**immutable to MANAGER; only the USER may change it, and doing so is a MAJOR bump.**

`MUST`: a kanban `column:` value is EXACTLY one of the 17 below — these spellings, no
others. `MUST`: every consumer (UI boards, GitHub-Project mirrors, `amp-kanban-*.sh`,
role-plugins, `types/task.ts`, `types/team.ts`) aligns TO this list; a coarser view may
GROUP columns for display but MUST round-trip mutations back to these 17. **Never the
reverse** — no consumer invents, renames, or collapses a column.

The 14 lifecycle columns are in canonical progression order; the 3 exception columns are
orthogonal (a card enters them from any working column and returns).

<!-- @spec:kanban-columns v1 — authoritative; the conformance test extracts the block below verbatim -->
```text
backburner
todo
design
dispatch
dev
testing
ai_review
human_review
complete
publish
published
deploy
live
live_auditing
blocked
failed
superseded
```

**Lifecycle contract** (the legal shape; per-transition *authority* — which TITLE may
trigger each move — is a DEP concern, see `aimaestro-trdd-approval.md` Part B2):

- Happy path: `backburner → todo → design → dispatch → dev → testing → ai_review →
  (human_review) → complete`, then `publish → published` (tools, `release-via: publish`)
  OR `deploy → live → (live_auditing)` (services, `release-via: deploy`).
- `testing` may return to `dev` on failure; `ai_review` may return to `dev` on rejection.
- `blocked` is entered from any working column whenever `blocked-by:` is non-empty, and
  returns to `pre-block-column:` when it clears.
- `failed` is retryable and stays on the board — it is NEVER auto-archived.
- `superseded` is terminal and leaves the board on the next archival pass.

## Pillar 2 — the TRDD contract

- **Id grammar**: `MUST` match `^[A-Z0-9]{8}$` — 8-char UPPERCASE base36. This IS the
  canonical id (no UUID). `MUST` be unique across BOTH scope roots (project + local).
- **Filename**: `TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md`.
- **Frontmatter is grep-first**: `MUST` be one field per line; lists flow-style
  `[a, b, c]`; enums bare kebab-case; dates ISO-8601 with local offset
  (`%Y-%m-%dT%H:%M:%S%z`); titles contain no colons; no trailing whitespace on data lines.
- **Minimal required fields**: `trdd-id, title, column, created, updated, current-owner,
  task-type`. The schema is OPEN — any field the implementations define may be added.
- **`column:`** is the state machine and `MUST` draw from Pillar 1.
- **Scope = path**: a TRDD is `project` (in `<repo>/design/`, git-tracked) or `local`
  (in `~/.claude/projects/<slug>/design/`, machine-private). The **path is
  authoritative**; a `scope:` field is a lint target on disagreement.
- **`MUST` bump `updated:` on EVERY edit** — the board sorts on it.
- A TRDD spanning more than one session `MUST` carry the STATE head block.

## Pillar 3 — the PRRD contract

- **Two tiers**: 🥇 GOLDEN (USER-set, immutable to every agent incl. MANAGER) and
  🥈 SILVER (MANAGER-mutable). Both are one flat bullet list per section in `PRRD.md`.
- **Rule identity**: `<letter><number>.<version>` — `G`/`S` = current tier (flips on
  promote/demote), `number` = globally unique across BOTH tiers and **never reused**,
  `version` = forward-only edit counter. `MUST`: a citation by number resolves to the
  same rule regardless of the G/S letter; tools accept the number alone.
- **Citation grammar**: `PRRD G64.134` — the space is mandatory (it is what makes it
  greppable).
- **Mutation authority** (base): USER may edit any rule; the project's own Claude may
  edit SILVER. The multi-agent per-TITLE authority matrix + COS-routed proposal queue is
  a DEP concern (see `aimaestro-prrd-governance.md`).

## Pillar 4 — the IND/DEP boundary (the classification test)

*(This is the boundary the janitor applies on every base edit and previously applied
from memory — ai-maestro#85 item 4.)*

A normative statement belongs to the **IND universal base** iff it is **TRUE and USEFUL
for a project with NO ai-maestro harness** — a solo git repo with one Claude and the
human USER as sole approver. It belongs to a **DEP overlay** iff it **presupposes the
ai-maestro harness**. A DEP overlay EXPANDS an IND base and `MUST NOT` restate it.

| A statement that mentions… | Layer |
|---|---|
| one Claude; the USER approves; a plain git repo; markdown + grep | **IND** |
| the 17-column vocabulary, TRDD/PRRD file formats, folder lifecycle | **IND** (the contract; this spec) |
| governance TITLES (MANAGER/COS/ORCHESTRATOR/…); the comm graph | **DEP** |
| `min-approval-requirement`, approval tiers, mandate authority, COS routing | **DEP** |
| the ai-maestro server as notarizer/enforcer; `$AID_AUTH`; the dashboard | **DEP** |
| cross-agent transition authority (who may trigger a column move) | **DEP** |
| multi-agent shared board, dashboard/GitHub-Project mirrors, assignees | **DEP** |

Rule of thumb: **IND says WHAT the artefact is; DEP says WHO, in a multi-agent fleet,
may act on it.** When a statement is true even with the harness removed, it is IND.

## Conformance checks (who verifies what)

- **ai-maestro, code side** — `tests/unit/three-pillars-spec-conformance.test.ts`
  asserts `types/task.ts::DEFAULT_STATUSES` deep-equals this spec's Pillar-1 block
  (TRDD-QP07O1BK). This is the platelet that keeps the spec from being drift-prone prose.
- **ai-maestro, overlay side** — `tests/unit/aimaestro-overlay-filename-contract.test.ts`
  freezes the DEP overlay filenames the IND bases cite (#83) and pins this spec's
  colocation in `rules/aimaestro/`.
- **janitor side** — a check (janitor's to build, #85) that its shipped IND bases satisfy
  this spec at the `spec-version` they declare.

## Maintenance

This file is **maintained and non-archived** (an archived TRDD cannot serve as a living
spec — the wrong shape the janitor correctly rejected in #85). USER-ratified invariants
(the 17-column vocabulary, the golden/silver top-level model) are immutable to MANAGER;
other clarifications are MANAGER-revisable. Any change to a `MUST` bumps `spec-version`
per the rules above.
