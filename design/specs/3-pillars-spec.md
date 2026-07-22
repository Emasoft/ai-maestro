---
spec: 3-pillars
spec-version: 1.1.1
status: normative
created: 2026-07-22T07:54:21+0200
updated: 2026-07-22T09:28:36+0200
maintainer: ai-maestro
project-id: ai-maestro
requested-by: Emasoft/ai-maestro#85
implementations:
  - "janitor IND bases — ~/.claude/rules/{trdd-design-tasks,prrd-design-rules,universal-kanban}.md — canonical repo Emasoft/ai-maestro-janitor"
  - "ai-maestro DEP overlays — rules/aimaestro/aimaestro-*.md (this repo)"
  - "ai-maestro enforcement code — types/task.ts, types/team.ts, lib/kanban-field-authority.ts, docs/GOVERNANCE-RULES.md (this repo)"
---

# The 3-pillars conformance SPEC

**This file is the SPEC, not a rule.** It is the single, versioned, normative source the
3-pillars implementations conform to. Implementations carry the teaching prose and the
executable logic; this carries the testable contract. On any disagreement, the spec is
the arbiter.

## 3P-GREP — how to grep this spec

This is a REFERENCE doc: every normative clause starts with a stable `` `3P-<FAMILY>-NN` ``
anchor and a bold key-phrase, so you grep to the clause instead of reading through.

```text
3P-GREP  all clauses of a family:   grep '3P-KAN'      (or META TRDD PRRD BND VER CHK MNT)
3P-GREP  one clause by id:          grep '3P-KAN-01'
3P-GREP  the authoritative columns: grep -A20 '@spec:kanban-columns'
3P-GREP  the version stamp:         grep '^spec-version:'
3P-GREP  families: META=arbiter KAN=kanban TRDD=trdd PRRD=prrd BND=ind/dep-boundary
3P-GREP            VER=versioning CHK=conformance-checks MNT=maintenance
```

## 3P-META — the arbiter, and the anti-drift discipline

`3P-META-01` **arbiter** — this file is the single versioned normative source; where an
implementation and this spec disagree, THE SPEC WINS. Implementations cite it and conform.

`3P-META-02` **not-a-mirror** — the spec MUST NOT re-narrate rule prose. A prose copy is
the `design/rules-refactor/independent/` mirror ai-maestro RETIRED in TRDD-TAFH4U0G (drift
reborn as a third disagreeing copy). It states VALUES + `MUST`-assertions + the boundary
test; the teaching prose stays in the rules, the executable logic in the code.

`3P-META-03` **why-it-exists** — the 17-column vocabulary alone lives duplicated across
five artefacts (`universal-kanban.md`, `types/task.ts`, `types/team.ts`, GOVERNANCE-RULES
R25, the DEP overlays) with no arbiter; two independently-authored halves with no shared
source is how the IND/DEP split silently drifts (ai-maestro#83/#85, janitor#73, DE9757LJ).

## 3P-VER — versioning & conformance

`3P-VER-01` **semver-bump** — `spec-version` is semver. MAJOR = a `MUST` changes (a column
renamed/added/removed, the id grammar, a tier-authority rule). MINOR = an optional field or
a non-breaking clarification (incl. adding a clause). PATCH = wording only.

`3P-VER-02` **conforms-to** — an implementation MAY declare `conforms-to-spec:
3-pillars@<version>`. A declared version ≠ this file's `spec-version` is a DETECTABLE
conformance failure — the whole point of the stamp.

`3P-VER-03` **clause-ids-stable** — every `3P-<FAMILY>-NN` id is STABLE, never reused, and
append-only. A conformance check may cite a clause by id, so a citation resolves to the
same clause across versions; deleting a clause tombstones its id (never re-assign it).

`3P-VER-04` **bidirectional-loop** — #83 froze the overlay FILENAMES the IND bases cite;
this spec + the janitor check freeze the content CONTRACT. Together they close the loop in
both directions.

## 3P-KAN — Pillar 1: the kanban column vocabulary (17 columns)

`3P-KAN-01` **enum** — `MUST`: a `column:` value is EXACTLY one of the 17 in the block
below, these spellings, no others.

`3P-KAN-02` **user-ratified** — the vocabulary is USER-ratified (TRDD-YUGDER9D /
GOVERNANCE-RULES R25): immutable to MANAGER; only the USER may change it, and a change is a
MAJOR bump.

`3P-KAN-03` **align-to** — `MUST`: every consumer (UI boards, GitHub-Project mirrors,
`amp-kanban-*.sh`, role-plugins, `types/task.ts`, `types/team.ts`) aligns TO this list,
never the reverse. A coarser view MAY group columns for display but `MUST` round-trip
mutations back to these 17.

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

`3P-KAN-04` **lifecycle** — happy-path order: `backburner → todo → design → dispatch → dev
→ testing → ai_review → (human_review) → complete`, then `publish → published`
(`release-via: publish`) OR `deploy → live → (live_auditing)` (`release-via: deploy`).

`3P-KAN-05` **return-edges** — `testing` may return to `dev` on failure; `ai_review` may
return to `dev` on rejection.

`3P-KAN-06` **blocked** — entered from any working column whenever `blocked-by:` is
non-empty; record `pre-block-column:` and restore to it when it clears.

`3P-KAN-07` **failed** — retryable; stays on the board; NEVER auto-archived.

`3P-KAN-08` **superseded** — terminal; leaves the board on the next archival pass.

`3P-KAN-09` **transition-authority-is-DEP** — WHICH title may trigger a given move is a DEP
concern, not IND; see `aimaestro-trdd-approval.md` Part B2. (This clause is itself a 3P-BND
worked example.)

## 3P-TRDD — Pillar 2: the TRDD contract

`3P-TRDD-01` **id-grammar** — `MUST` match `^[A-Z0-9]{8}$` (8-char UPPERCASE base36). This
IS the canonical id (no UUID). `MUST` be unique across BOTH scope roots (project + local).

`3P-TRDD-02` **filename** — `TRDD-<YYYYMMDD_HHMMSS±HHMM>-<id8>-<slug>.md`.

`3P-TRDD-03` **frontmatter-grep-first** — `MUST` be one field per line; lists flow-style
`[a, b, c]`; enums bare kebab-case; dates ISO-8601 with local offset
(`%Y-%m-%dT%H:%M:%S%z`); titles contain no colons; no trailing whitespace on data lines.

`3P-TRDD-04` **required-fields** — minimal set: `trdd-id, title, column, created, updated,
current-owner, task-type`. The schema is OPEN — implementations may add fields.

`3P-TRDD-05` **column-is-state** — `column:` is the state machine and `MUST` draw from
3P-KAN.

`3P-TRDD-06` **scope-is-path** — a TRDD is `project` (in `<repo>/design/`, git-tracked) or
`local` (in `~/.claude/projects/<slug>/design/`, machine-private). The PATH is
authoritative; a `scope:` field is a lint target on disagreement.

`3P-TRDD-07` **bump-updated** — `MUST` bump `updated:` on EVERY edit (the board sorts on
it).

`3P-TRDD-08` **state-block** — a TRDD spanning more than one session `MUST` carry the STATE
head block.

## 3P-PRRD — Pillar 3: the PRRD contract

`3P-PRRD-01` **two-tiers** — 🥇 GOLDEN (USER-set, immutable to every agent incl. MANAGER)
and 🥈 SILVER (MANAGER-mutable). Both are one flat bullet list per section in `PRRD.md`.

`3P-PRRD-02` **rule-identity** — `<letter><number>.<version>`: `G`/`S` = current tier
(flips on promote/demote); `number` = globally unique across BOTH tiers, NEVER reused;
`version` = forward-only edit counter.

`3P-PRRD-03` **cite-by-number** — a citation by number resolves to the same rule regardless
of the G/S letter; tools accept the number alone.

`3P-PRRD-04` **citation-grammar** — `PRRD G64.134` — the space is mandatory (it is what
makes it greppable).

`3P-PRRD-05` **mutation-authority** — base: USER may edit any rule; the project's own Claude
may edit SILVER. The multi-agent per-TITLE authority matrix + COS-routed proposal queue is
a DEP concern (see `aimaestro-prrd-governance.md`).

## 3P-BND — Pillar 4: the IND/DEP boundary (the classification test)

`3P-BND-01` **the-test** — a normative statement belongs to the **IND universal base** iff
it is TRUE and USEFUL for a project with NO ai-maestro harness (a solo git repo, one Claude,
the USER as sole approver). It belongs to a **DEP overlay** iff it PRESUPPOSES the harness.
A DEP overlay EXPANDS an IND base and `MUST NOT` restate it. *(This is the item the janitor
applied from memory until now — ai-maestro#85 item 4.)*

`3P-BND-02` **discriminator-table** —

| a statement that mentions… | layer |
|---|---|
| one Claude; the USER approves; a plain git repo; markdown + grep | **IND** |
| the 17-column vocabulary, TRDD/PRRD file formats, folder lifecycle | **IND** (the contract; this spec) |
| governance TITLES (MANAGER/COS/ORCHESTRATOR/…); the comm graph | **DEP** |
| `min-approval-requirement`, approval tiers, mandate authority, COS routing | **DEP** |
| the ai-maestro server as notarizer/enforcer; `$AID_AUTH`; the dashboard | **DEP** |
| cross-agent transition authority (who may trigger a column move) | **DEP** |
| multi-agent shared board, dashboard/GitHub-Project mirrors, assignees | **DEP** |

`3P-BND-03` **rule-of-thumb** — IND says WHAT the artefact is; DEP says WHO, in a fleet, may
act on it. If a statement is true with the harness removed, it is IND.

## 3P-CHK — conformance checks (who verifies what)

`3P-CHK-01` **ai-maestro-code** — `tests/unit/three-pillars-spec-conformance.test.ts`
asserts `types/task.ts::DEFAULT_STATUSES` deep-equals 3P-KAN-01's block (TRDD-QP07O1BK) —
the platelet that keeps this spec from being drift-prone prose.

`3P-CHK-02` **ai-maestro-overlay** — `tests/unit/aimaestro-overlay-filename-contract.test.ts`
freezes the DEP overlay filenames the IND bases cite (#83). (This SPEC lives in `design/specs/`,
the standard SPEC home. The DEP overlays are ALSO specs but stay in `rules/aimaestro/` because they
are SEEDED to agent workdirs by that path — a mechanical constraint, not a taxonomy exception.)

`3P-CHK-03` **janitor** — a check (janitor's to build, #85) that its shipped IND bases
satisfy this spec at the `spec-version` they declare.

## 3P-MNT — maintenance

`3P-MNT-01` **living** — this file is MAINTAINED and NON-archived (an archived TRDD cannot
serve as a living spec — the wrong shape the janitor correctly rejected in #85).

`3P-MNT-02` **change-authority** — USER-ratified invariants (3P-KAN-02, the golden/silver
top-level model) are immutable to MANAGER; other clarifications are MANAGER-revisable; any
change to a `MUST` bumps `spec-version` per 3P-VER-01.

`3P-MNT-03` **keep-it-greppable** — every clause `MUST` keep its `` `3P-<FAMILY>-NN` ``
anchor + a bold key-phrase at the line start, and 3P-GREP `MUST` list every family. A new
clause takes the next free NN in its family (never a reused id, per 3P-VER-03).
