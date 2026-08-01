---
spec: 3-pillars
spec-version: 1.5.0
status: normative
created: 2026-07-22T07:54:21+0200
updated: 2026-08-01T19:31:12+0200
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
3P-GREP  all clauses of a family:   grep '3P-KAN'  (or META TRDD PRRD DAG IDX BND VER CHK MNT)
3P-GREP  one clause by id:          grep '3P-KAN-01'
3P-GREP  the authoritative columns: grep -A20 '@spec:kanban-columns'
3P-GREP  the version stamp:         grep '^spec-version:'
3P-GREP  families: META=arbiter KAN=kanban TRDD=trdd PRRD=prrd DAG=reference-dag
3P-GREP            IDX=index-safety BND=ind/dep-boundary VER=versioning
3P-GREP            CHK=conformance-checks MNT=maintenance
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

### The pipeline invariant (USER-ratified 2026-08-01)

The preceding clauses define the board's SHAPE. These define its PURPOSE, because every one
of them can be satisfied while nothing is processed. The board is an extended todo QUEUE with
a direction of flow; it exists to ensure tasks are always being worked.

`3P-KAN-10` **pipeline-not-cabinet** — `MUST`: the board is a PIPELINE. A card in a
non-resting column that is not progressing is a DEFECT, not a neutral state. The resting
columns are exactly `backburner` and the terminal set; `todo` through `human_review` are
WORKING columns and assert motion.

`3P-KAN-11` **blocked-is-the-only-stillness** — `MUST`: a card may sit still ONLY with a
non-empty `blocked-by:` naming an OPEN card (3P-KAN-06). Stillness without one is a stall.
Corollary: `blocked-by:` naming a TERMINAL card is not a licence — it is drift, and the card
must resume.

`3P-KAN-12` **wip-matches-capacity** — `MUST`: a WORK column (`dev`/`testing`/`ai_review`)
asserts that a worker is progressing that card NOW. The count of such cards `MUST NOT` exceed
the number of workers able to progress them. **An untrue column is worse than an unstarted
card**: it hides the stall from the one view anyone consults.

`3P-KAN-13` **drain-by-default** — `MUST`: completing a card obliges PULLING the next
eligible one. The board is itself the instruction: the absence of a fresh human request
`MUST NOT` be read as authority to leave the queue idle.

`3P-KAN-14` **queueing-is-a-handoff-not-a-resolution** — filing a card at `todo` discharges
the obligation to RECORD work, never the obligation to DO it. A queue nothing pulls from is
where work disappears with a clean conscience.

`3P-KAN-15` **close-in-session** — `MUST`: a card whose work is demonstrably done is closed
in the SAME session that finished it. An unclosed complete card is indistinguishable from an
abandoned one and inflates the WORK columns until they mean nothing.

`3P-KAN-16` **repair-per-card-never-scripted** — `MUST NOT`: mass-repair a stalled board with
a scripted sweep. Each card needs a per-card judgment (done-but-unclosed / superseded /
abandoned / genuinely pending) that a regex over prose cannot make; a sweep destroys the audit
trail it was meant to repair. Classify first, decide per card.

> **The measurement this was ratified from** (ai-maestro, 2026-08-01): 113 open cards, **37 in
> `dev`**, exactly ONE touched that day, 20 of the 37 stale ≥8 days and three 39 days; only 7
> of all 113 carried a `blocked-by:`. Every card was correctly filed and nothing was flowing —
> the board's most-populated column was its least honest one. Filing had become a substitute
> for doing. 3P-KAN-10..16 exist so that state is a spec violation rather than a habit.

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

`3P-TRDD-09` **status-is-not-column** — `status:` is a DISTINCT field, `NOT` a retired
duplicate of `column:`. It carries a different aspect and `MUST NOT` be treated as dead: the
pillar specs themselves use it (`status: normative`). What v1 kept in `status:` was the
PIPELINE STATE, and v2 moved *that one aspect* to `column:`. Therefore:
- a tool `MUST NOT` key on the FIELD NAME. A `status:` holding a **pipeline-state value**
  (either spelling — v2 per 3P-KAN, or a v1 value such as `not-started`) is the v1 residue and
  `MAY` be reported and auto-repaired; a `status:` holding anything else is the field doing its
  own job and `MUST` be left untouched, not even warned.
- `column:` `MUST` win over any `status:` on disagreement (3P-TRDD-05 — `column:` is the state
  machine). A v1 `status:` `MUST NEVER` override a v2 `column:`.
- a detector `MUST NOT` synthesize a state for a missing field. Report *"no state field"*; a
  fabricated value is indistinguishable downstream from a real one.
- v1 `status:` frontmatter is `NOT` extinct fleet-wide (measured 2026-07-30: 66 instances in
  TRDD zones across 3 repos), so a reader `MAY` be gated but `MUST NOT` be deleted as dead.

`3P-TRDD-10` **one-state-claim** — a TRDD `MUST` state its pipeline position exactly ONCE. A
body-level state claim (`**Status:**`, `**Column:**`, a line-initial `Status:`) is a SECOND
source of truth and `MUST` be reported: an ERROR when it disagrees with `column:`, a WARN when
it merely duplicates it. A disagreeing pair `MUST NOT` be auto-resolved — which claim is true
is a judgment, and a tool that picks one silently loses work.

`3P-TRDD-11` **missing-column-fallback** — when `column:` is ABSENT a repair tool `MAY`
insert `column: todo`, deliberately, so the next agent must evaluate the task before acting.
This fallback applies `ONLY` to a genuinely missing field. It is `NOT` licence to repurpose
another field: any other frontmatter field, `status:` included, `MUST` survive the repair with
its value intact.

`3P-TRDD-12` **validate-before-write** — a tool that WRITES a TRDD `MUST` validate the
RESULTING frontmatter (the edit merged over the card's current fields, never the edit alone)
against this spec's grammar BEFORE the write lands, and `MUST` refuse rather than warn: after
a refusal the file `MUST` be byte-identical, because a refusal that half-writes is worse than
no gate. The check `MUST` read the SAME vocabulary the linter reads, so a value the linter
would ERROR on cannot be written in the first place — one definition, not two that drift. A
post-hoc linter is `NOT` a substitute: it reports corruption that already happened, and the
158 column-less cards this clause exists to prevent were every one of them written by a seam
that checked only that each value was a string (TRDD-SCMPWF6R).

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

## 3P-DAG — the cross-pillar reference DAG (which pillar may reference which)

`3P-DAG-01` **reference-direction** — references point only UP the abstraction stack,
`PRRD ← SPECS ← TRDD`. TRDD MAY reference {TRDD, SPECS, PRRD}; SPECS MAY reference
{SPECS, PRRD}; PRRD `MUST NOT` reference anything. So `SPECS → TRDD` and `PRRD → *` are
illegal edges.

`3P-DAG-02` **dependency-fields-only** — the DAG constrains EXACTLY the frontmatter
dependency allowlist `blocked-by`, `npt`, `eht`, `parent-trdd`, `superseded-by`,
`relevant-rules`. Anything else that names a record — a BODY sentence, or a free-text
frontmatter value — is PROVENANCE and `MUST NOT` be counted as an edge. *(Boundary test:
the specs name TRDD ids in prose, this file included, and a checker scoped to "frontmatter,
not bodies" rather than to the allowlist still wrongly flags the ones sitting inside the
free-text `implementations:` and `authority:` values. Dated census: TRDD-LXLK7XGX.)*

`3P-DAG-03` **id-forms** — a dependency-field value `MUST` be resolved through the target
pillar's canonical id normalization: the id prefix is OPTIONAL and matching is
case-insensitive, and a value may arrive as a YAML number. So all of `[ABCD1234]`,
`[TRDD-ABCD1234]`, `[TRDD-abcd1234]` and `[25]` denote edges. A checker keyed on the
prose-CITATION pattern (which requires the prefix) is NON-CONFORMANT: it yields ZERO edges
for the bare and numeric forms and then reports a clean corpus because it saw nothing.

## 3P-IDX — the derived index and its safety contract

Every clause here pins a MUST whose violation is **SILENT** — that is the selection rule. An index
that fails loudly is a bug; one that quietly answers from a stale, emptied or nuked cache is the
class this family exists to prevent.

`3P-IDX-01` **accelerator-not-authority** — an index is DERIVED from the markdown corpus and
`MUST NOT` be the only home of any answer. That is precisely what makes deleting it a legal repair;
a store that owned anything could not self-heal by nuking itself.

`3P-IDX-02` **outside-the-corpus** — the index file `MUST` live outside the corpus it indexes (host
state, gitignored), and its key `MUST` include a hash of the REALPATH-resolved corpus root. A
readable slug alone collides where it matters most — every agent workdir and every LOCAL corpus is
named `design` — so slug-only keying silently makes N corpora share one index.

`3P-IDX-03` **one-stamp-append-only** — the schema version is `PRAGMA user_version` checked against
ONE `SCHEMA_VERSION` constant, and the ladder is APPEND-ONLY. A SHIPPED step is IMMUTABLE: adding a
column `MUST` take a new number, or two machines reporting the same version disagree about their
shape and no validate can detect it.

`3P-IDX-04` **migrate-atomically** — each ladder step `MUST` run in its own `BEGIN IMMEDIATE`
transaction, write the stamp INSIDE that transaction, and re-validate AT THAT VERSION before
commit. Stamp and shape land or fail together: a step that half-applies and still stamps is exactly
what makes a later validate report damage on a DB nothing damaged.

`3P-IDX-05` **behind-is-not-damage** — a missing table or column means TWO different things, and the
stamp is the only discriminator: `user_version < SCHEMA_VERSION` is BEHIND the ladder (`MUST`
migrate, `MUST NOT` rebuild); `== SCHEMA_VERSION` means a migration LIED and the DB is damaged. The
two verdicts `MUST` be ORTHOGONAL, never alternatives — a DB can be behind without damage (the
common case), damaged without being behind, or both. The required shape `MUST` also be versioned PER
COLUMN, not per table. *(Boundary test: janitor#123's defect was a column-granular skew; a per-table
`since` cannot express it, so it demands the newest version's columns from a DB that legitimately
predates them and reports a healthy behind-DB as damaged.)*

`3P-IDX-06` **downgrade-is-never-healed** — a DB whose `user_version` EXCEEDS the binary's carries
its own distinct fault code and `MUST NOT` be rebuilt. A newer index is not a broken one; the repair
is the opposite one — upgrade the code.

`3P-IDX-07` **validate-never-heals** — the validate path `MUST NOT` repair what it measures. An
observer that silently fixed things makes a recurring corruption invisible to the very tool asked
whether corruption recurs.

`3P-IDX-08` **depth-is-a-schedule-not-a-weakening** — validate has two depths: `structural`
(metadata-only, cost FLAT in corpus size) is what a READ path may afford, while `full` (adding the
whole-file integrity walk) `MUST` run at every STATE TRANSITION — creation, each migration step, and
every heal. A read cannot cause what it does not write, so paying for whole-index scans per read
buys nothing. *(Boundary test, measured: the full pass on every open made the SAFETY MECHANISM the
scaling wall — an 11 ms graph query behind a 666 ms open.)*

`3P-IDX-09` **heal-is-an-event** — a self-heal `MUST` append to a BOUNDED, atomically-rewritten
ledger, and `MUST NOT` fail because its own audit trail was unreadable. An untraced heal races the
observer and wins, so a corruption recurring daily reads as a healthy index to anything inspecting
only current state. Deleting an index `MUST` take its `-wal`/`-shm` sidecars with it — they carry
committed pages, and SQLite would otherwise reconstruct from a WAL belonging to a database that no
longer exists.

`3P-IDX-10` **busy-timeout-before-wal** — `busy_timeout` `MUST` be set BEFORE
`journal_mode = WAL`. Otherwise WAL silently fails to take while another process holds the lock, and
the DB stays in rollback-journal mode with the setting appearing applied.

`3P-IDX-11` **duplicate-ids-are-storable** — the record key `MUST` include the file path, so a
duplicate id across two files is STORED and reportable as a lint finding rather than rejected by a
constraint. An index that refuses to represent a defect the linter exists to report cannot describe
its own corpus.

`3P-IDX-12` **index-the-join-not-just-the-documents** — resolved reference EDGES `MUST` be stored,
not documents alone. Validating a corpus is a JOIN — every `blocked-by`/`npt`/`eht`/`parent-trdd`/
`superseded-by` must resolve — so a document-only index leaves that cost untouched: O(N × refs ×
lookup), and quadratic when the lookup itself rescans.

`3P-IDX-13` **accretion-line** — a column enters the index only when an INDEX-SERVED query reads it;
a field a consumer starts reading takes a MIGRATION, not a widened SELECT. This is what bounds the
schema's growth.

`3P-IDX-14` **search-stays-on-the-walk** — regex search `MUST NOT` be served from FTS5: it cannot
evaluate a regex, and its tokenizer splits a prefixed id into whole tokens, so even a literal
prefilter misses substrings. "Index the search byte-identically" is self-contradictory, not deferred.
And a parity check over an UNPOPULATED FTS table is satisfied by construction, so it `MUST NOT` be
reported as passing — if a consumer is ever built, the INSERT and its parity check return together
as ONE decision.

`3P-IDX-15` **expensive-pass-needs-a-caller** — an integrity pass that no code path invokes `MUST
NOT` be counted as a safety mechanism. A validator reachable only from a test proves the FUNCTION
works, never that the SYSTEM is checked: the cheap per-open validate ran on every query while the
full pass (`integrity_check`, FTS parity, orphan rows) had no production caller at all, so the
expensive half of the contract was documented, tested, and never executed. Every declared pass
`MUST` name the caller that runs it and the cadence — a detector, a repairer, a scheduled sweep —
and a pass whose only caller is its own test `MUST` be reported as unwired rather than as present.

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
the standard SPEC home. The DEP overlays it references are RULE FILES, not specs — they live in
`rules/aimaestro/` (their seed/install folder); this spec DESCRIBES them, it is not one of them.)

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
