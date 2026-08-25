---
spec: 3-pillars
spec-version: 3.0.0
status: normative
created: 2026-07-22T07:54:21+0200
updated: 2026-08-23T16:10:00+0200
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
3P-GREP  all clauses of a family:   grep '3P-KAN'  (or META TRDD ZON PRRD DAG IDX BND VER CHK MNT)
3P-GREP  one clause by id:          grep '3P-KAN-01'
3P-GREP  the authoritative columns: grep -A25 '@spec:kanban-columns'
3P-GREP  the version stamp:         grep '^spec-version:'
3P-GREP  families: META=arbiter KAN=kanban TRDD=trdd ZON=zone-pipeline PRRD=prrd DAG=reference-dag
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

`3P-META-03` **why-it-exists** — the column vocabulary alone lives duplicated across
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

`3P-VER-05` **change-signal-is-the-blob-sha** — a consumer polling for changes `MUST` poll
the per-FILE blob sha, never the branch commit sha:

```bash
gh api "repos/Emasoft/ai-maestro/contents/design/specs/3-pillars-spec.md?ref=governance-rules" --jq .sha
gh api "repos/Emasoft/ai-maestro/contents/rules/aimaestro?ref=governance-rules" --jq '.[] | "\(.sha[0:12])  \(.name)"'
```

A blob sha changes **iff** those bytes change, so six shas are a complete per-file
fingerprint of the SPEC + all five DEP overlays. This also covers what `spec-version` alone
cannot: the overlays carry no version field, so an overlay-only edit moves no number.

**The branch commit sha is FORBIDDEN as a change signal, and the reason is that it fails in
the dangerous direction.** It moves on every unrelated commit, so a conforming consumer
polls, sees movement, refetches, gets a byte-identical document, and records "checked,
current" — manufacturing confidence instead of supplying information. Silence would be
safer. Measured on ai-maestro#97 (2026-07-31, reproduced 2026-08-04): the branch sha moved
`7b1a3e64 → ea97c73c` on four commits (`docs(lessons)`, `docs(pm2)`, `fix(oauth-rotator)`, a
TRDD zone move) while the SPEC blob sat unchanged at `b38d895f…` for 13 days — during which
the served version was `1.1.1` and the working copy reached `1.5.0`. I had documented the
branch sha as the signal on 2026-07-29; that guidance is RETRACTED by this clause.

The general form, worth stating because it outlives this instance: **an amendment the
designated authority does not SERVE is not published, however correct its text** — so the
signal must watch the served artifact, not the repository that produces it.

## 3P-KAN — Pillar 1: the kanban column vocabulary (22 columns)

`3P-KAN-01` **enum** — `MUST`: a `column:` value naming a position ON THE BOARD is EXACTLY one
of the 22 in the block below, these spellings, no others.

`3P-KAN-20` **bracket-values-are-legal-and-are-not-board-columns** — `MUST`: the BOARD
vocabulary (22) and the LEGAL SET for a `column:` field (27) are different sets, and conflating
them is a defect in both directions. Five BRACKET values sit OUTSIDE the board, at either end
of it, and are legal `column:` values:

```text
proposal    planned    refused    completed    cancelled
```

`proposal`/`planned` are the intake antechamber ahead of `backburner`; `refused`/`completed`/
`cancelled` are archival terminals. They are defined by the FOLDER LIFECYCLE (3P-ZON), not by
3P-KAN, which is why they are absent from the block below — a card at one of them is not on the
board at all.

**This clause is a REPAIR of a defect that predates 3.0.0, surfaced by the 3.0.0 amendment.**
3P-KAN-01 has said "EXACTLY one of the N … no others" since 1.0.0 while the enforcement code has
always accepted `VALID_COLUMNS = DEFAULT_STATUSES + BRACKET_COLUMNS` (27). Measured on this
corpus 2026-08-23: **70 of 176 non-archived cards** carry a bracket value (51 `planned`,
19 `proposal`), i.e. the spec as literally written forbade 40% of the live board while the code,
the doctor and the linter all correctly accepted it. Nothing was broken — the SPEC was wrong, and
it was wrong in the direction that reads as fine, because the tool everyone actually runs
disagreed with it silently. Found by the ARCHITECT session cross-reading the amendment against
its own corpus, not by any test: no test compares the spec's prose count to `VALID_COLUMNS`.

`3P-KAN-02` **user-ratified** — the vocabulary is USER-ratified (TRDD-YUGDER9D /
GOVERNANCE-RULES R25; extended to 22 by `PRRD G2.1`, USER 2026-08-23, TRDD-UNTF690M):
immutable to MANAGER; only the USER may change it, and a change is a MAJOR bump.

`3P-KAN-03` **align-to** — `MUST`: every consumer (UI boards, GitHub-Project mirrors,
`amp-kanban-*.sh`, role-plugins, `types/task.ts`, `types/team.ts`, `trddgrep`,
`lib/trdd-doctor.ts`) aligns TO this list, never the reverse. A coarser view MAY group
columns for display but `MUST` round-trip mutations back to these 22.

<!-- @spec:kanban-columns v2 — authoritative; the conformance test extracts the block below verbatim -->
```text
backburner
approval
design
design_ai_review
design_human_review
todo
verify_assumptions
plan
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

`3P-KAN-04` **lifecycle** — happy-path order: `backburner → approval → design →
design_ai_review → (design_human_review) → todo → verify_assumptions → plan → dispatch →
dev → testing → ai_review → (human_review) → complete`, then `publish → published`
(`release-via: publish`) OR `deploy → live → (live_auditing)` (`release-via: deploy`).

`3P-KAN-17` **spelling** — the USER's ratifying directive spelled the five columns added in
3.0.0 with hyphens (`design-ai-review`, `design-human-review`, `verify-assumption`). The
ENUM IDENTIFIERS are snake_case, because all three pre-existing multi-word columns are
(`ai_review`, `human_review`, `live_auditing`) and a mixed enum invites typos no type-checker
catches. Hyphenated forms are human-readable names and `MAY` appear in prose; only the
snake_case forms are legal `column:` VALUES. (`PRRD G2.1`.)

`3P-KAN-18` **design-columns** — the four columns added ahead of `todo` in 3.0.0 carry these
meanings, normatively (`PRRD G3.1`–`G7.1`):
- `approval` — the card is with the CHIEF-OF-STAFF or the MANAGER (per its
  `min-approval-requirement:`) awaiting approval. `backburner` now means only *not yet
  approved*.
- `design` — the card is expanded IN PLACE with detailed design and specs by the DESIGNER (in
  a team) or by the implementer itself (outside one). See 3P-TRDD-13: **no second file**.
- `design_ai_review` — the design body is reviewed by the COS or the MANAGER.
- `design_human_review` — the human reviews it; a UI design `MUST` ship a visual artifact to
  annotate. **SKIPPED entirely when `min-approval-requirement: none`.**

`3P-KAN-19` **verify-and-plan** — the two columns added between `todo` and `dispatch` in
3.0.0 are gates on FACT and on METHOD (`PRRD G8.1`, `G9.1`):
- `verify_assumptions` — every claim in the card is verified; where a fact cannot be checked
  directly a TEST is created to verify it. Passes only when nothing in the card is still an
  assumption.
- `plan` — the implementation is planned by Claude Code's plan-mode steps run
  NON-interactively, every choice made autonomously from verified facts. Passes only when a
  complete plan FILE exists.
- `dev` gains one obligation (`PRRD G10.1`): the plan's steps are ENFORCED — executed and
  their execution verified — so they persist across sessions.

`3P-KAN-21` **pre-3.0.0-cards-are-grandfathered** — `MUST NOT` be auto-migrated. This covers
**every card that entered, before 2026-08-23, a column whose MEANING the amendment changed** —
not only `todo`. THREE columns changed meaning:

| column | meant, ≤2.x | asserts, 3.0.0 | measured drift |
|---|---|---|---|
| `todo` | approved and queued | approved **AND designed** | 62 of 176 cards; **1** carries any design field |
| `design` | queued, being designed (it sat AFTER `todo`, so it made no approval claim) | approved, undesigned, not yet queueable | **5 of 8** carry no `approved:` at all |
| `backburner` | deferred | **not yet approved** (`PRRD G3.1`) | **9 of 15** carry `approved: true` |

Note the two design/backburner drifts run in OPPOSITE directions — under-approved and
over-approved — which is precisely why no sweep can repair them and why each is a per-card
judgment.

The boundary is the amendment date. A card that entered one of those columns on or before
2026-08-23 is CONFORMANT as it stands and `MUST NOT` be flagged; a card entering after it asserts
the new meaning. Stating the boundary is the whole clause: un-bounded, this is a wall of warnings
on ~76 cards whose authors did nothing wrong, and a linter that cries wolf on the majority of its
corpus gets routed around — which is how the checklist gate went vacuous on 87 of 108 cards once
already.

**This clause was widened hours after it was written, and the reason is worth keeping.** It first
named `todo` ALONE, because `todo` was the drift I had measured. The ARCHITECT session then
measured `design` and `backburner` and found 14 more cards outside a boundary written for exactly
their situation — *"a rule whose literal scope is narrower than the situation it was written for"*,
which is the identical defect 3P-KAN-20 had just repaired one clause earlier. Two instances in one
amendment: the failure is not carelessness about one column, it is writing a grandfather boundary
from the drift you happened to measure instead of from the set of things that changed.

Re-columning a grandfathered card is a PER-CARD judgment for its owner, never a sweep. A scripted
pass over prose it cannot parse destroys the audit trail it was meant to repair. This clause
authorizes leaving them; it does not authorize a script that moves them.

`3P-KAN-05` **return-edges** — `testing` may return to `dev` on failure; `ai_review` may
return to `dev` on rejection; `design_ai_review` and `design_human_review` may return to
`design` on rejection, which `MUST` bump `last-design-revision:` (3P-TRDD-13).

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
columns are exactly `backburner`, the terminal set, and the three columns that wait on a
DECISION BY ANOTHER PARTY — `approval`, `design_human_review` and `human_review`. Every other
column from `design` through `ai_review` is a WORKING column and asserts motion. A resting
column is not a licence to forget: for a card parked in one of the three, WHO it waits on `MUST`
be DERIVABLE without reading the body, and the wait itself is reportable.

`3P-KAN-22` **the-approver-is-derived-not-declared** — `MUST NOT` mint a field for it. The
approver of a resting-decision card is already determined:

| column | who it waits on | from |
|---|---|---|
| `human_review` | the USER | the COLUMN — `human_review → complete\|dev` is USER-only |
| `design_human_review` | the USER (or the MANAGER, when the USER explicitly delegated acting on their behalf in their absence) | the COLUMN (`PRRD G6.1`) |
| `approval` | the CHIEF-OF-STAFF or the MANAGER | **`min-approval-requirement:`**, which already names the authority |

So the obligation in 3P-KAN-10 is satisfied by fields that exist, and a detector can evaluate it
today with no back-fill: measured 2026-08-23, **166 of 176** non-archived cards already carry
`min-approval-requirement:`, and all 4 cards at `human_review` do.

**Why this clause exists rather than a new field.** 3P-KAN-10's "name the approver" was added in
3.0.0 as prose and named no field, so as written it was a `MUST` that no card in the corpus
satisfied and no detector could check — the exact shape that gets read literally by a future
detector and reports the entire resting population as non-conformant. Two obvious fixes were
proposed (mint `awaiting-approver:` and back-fill, or declare the obligation prose-only and
un-checkable); both are worse than noticing that the fact is already recorded twice over. A field
whose value is always derivable from another field is a second source of truth waiting to
disagree with the first. Found by the ORCHESTRATOR session, which measured the absence across
four candidate field names before reporting it rather than asserting the gap.

One consequence worth stating: a card at `human_review` carrying `min-approval-requirement: none`
is not a contradiction to auto-repair. The field records the APPROVAL-GATE tier the card needed to
be authorized; the column records who owes the current verdict. They answer different questions
and a tool `MUST NOT` reconcile them.

`human_review` joined that set in 3.0.0, and it is a REPAIR, not a new policy. Until then this
clause read *"`todo` through `human_review` are WORKING columns"* while 3P-KAN-12's WIP list was
`dev`/`testing`/`ai_review` — so the two clauses already disagreed about `human_review`, and the
card correctly parked there awaiting a USER verdict read as a stall under 3P-KAN-11 with no
`blocked-by:` it could honestly name, because its blocker is a PERSON and not a card. That is
precisely the false signal 3P-KAN-12 calls worse than an unstarted card. Naming the principle in
3.0.0 ("waits on a decision by another party") is what made the omission visible: `human_review`
is the paradigm case of it. Found by the ORCHESTRATOR session, which also supplied the
corroborating tension with 3P-KAN-12 rather than only the symptom.

`3P-KAN-11` **blocked-is-the-only-stillness** — `MUST`: a card may sit still ONLY with a
non-empty `blocked-by:` naming an OPEN card (3P-KAN-06). Stillness without one is a stall.
Corollary: `blocked-by:` naming a TERMINAL card is not a licence — it is drift, and the card
must resume.

`3P-KAN-12` **wip-matches-capacity** — `MUST`: a WORK column
(`design`/`design_ai_review`/`verify_assumptions`/`plan`/`dev`/`testing`/`ai_review`)
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
insert one, deliberately, so the next agent must evaluate the task before acting. Since 3.0.0
(`PRRD G11.1`, USER 2026-08-23) the value is THREE-WAY, keyed on what the card can prove
about itself:

| the card | inserted column | why |
|---|---|---|
| `approved:` is not literally `true` | `backburner` | `G3.1` — backburner IS "not yet approved" |
| approved, `design-included` not `true` | `design` | approved but undesigned; it cannot queue yet |
| approved, `design-included: "true"` | `design_ai_review` | the design exists and needs reviewing |

It was a flat `todo` until 3.0.0, and that was correct only while `design` sat AFTER `todo`.
Now `todo` asserts *approved AND designed*, so inserting it would have the repairer
manufacture two claims nobody made. The `approved:` test is deliberately strict — `false`,
`rejected`, absent and unparseable all mean *cannot prove approval*, and a card parked one
column early costs a move while a card queued as approved when it was not is a false claim on
the board.

There `MUST` be exactly ONE implementation of this rule, shared by the lint MESSAGE and every
`--fix` insertion site. A `--fix` that repairs a shape the report did not describe is the
worst asymmetry a fix pipeline can have, because the report is the only thing a human reads
before running it. (`lib/trdd-vocabulary.ts::defaultColumnForMissing`.)

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

`3P-TRDD-13` **design-lives-in-the-card** — `MUST` (`PRRD G5.1`, 3.0.0): a card's
implementation design is written INTO THE SAME TRDD FILE. There is `NO` second document — no
`ATRDD`, no sidecar spec, no design folder per card; a redundant file is a second source of
truth that drifts from the card it describes. The card carries the ORIGINAL body plus the
design text, separated by a machine-greppable DIVIDER so a tool can extract the design half
alone:

```text
<!-- @trdd:design-body -->
```

- The divider `MUST` be that exact HTML comment on a line of its own. Everything AFTER it, to
  end of file, is the DESIGN BODY; everything before it is the ORIGINAL body. At most ONE
  divider per card — a second is an ERROR, because "the design half" would then be ambiguous.
- `trddgrep` `MUST` expose a filter that greps ONLY the design body (`--design-body`), and its
  complement (`--no-design-body`) for the original half. A design search that silently matches
  the problem statement is the drift this divider exists to prevent.
- Four frontmatter fields carry the design STATE, and they are the greppable half of it:
  `design-included: "true|false"` (a design body is present), `design-approved: "true|false"`
  (it cleared the design-review columns), `first-design-draft: "<DATETIME>"` (ISO 8601 with
  offset, set ONCE when the design body first lands) and `last-design-revision: "<DATETIME>"`
  (bumped on EVERY return to `design` from a design review).
- The fields `MUST` agree with the file: `design-included: true` `IFF` a divider is present;
  `design-approved: true` requires `design-included: true`; `first-design-draft` requires
  `design-included: true`; `last-design-revision` `MUST NOT` precede `first-design-draft`. A
  disagreement is an ERROR — the fields exist so a board query never has to open the body.
- A design choice that touches a PRRD golden or silver rule `MUST` be escalated per the card's
  `min-approval-requirement:` before it is written in, by the DESIGNER, by the design reviewer,
  or by the implementer acting alone outside a team (`PRRD G5.1`, `G6.1`).

## 3P-ZON — the ZONE pipeline: proposals → tasks → archived

A **ZONE** is the lifecycle FOLDER a card sits in. A **COLUMN** is its position on the 22-column
board. They are orthogonal and are constantly confused: 3P-KAN governs the column, 3P-TRDD-06 the
scope root, and until this family nothing governed the zone. The zone answers *"is this card
authorized, open, or finished?"*; the column answers *"how far along is it?"*.

`3P-ZON-01` **four-zones** — `MUST`: every scope root holds exactly four lifecycle folders —
`proposals/` (awaiting authorization), `tasks/` (OPEN work), `archived/` (once-approved, now
terminal), `refused/` (never approved). A card `MUST` sit in exactly one. The four exist in BOTH
scope roots (3P-TRDD-06), so every clause here applies by swapping one path.

`3P-ZON-02` **zone-column-agreement** — `MUST`: zone and `column:` `MUST NOT` contradict.
`proposals/` ⇒ `column: proposal`; `refused/` ⇒ `column: refused`; `archived/` ⇒ a terminal column;
`tasks/` ⇒ any NON-terminal, non-`proposal`, non-`refused` column. A mismatch is an ERROR, not a
warning: the open-card count is read off the zone, so a terminal column left in `tasks/` makes that
count a lie — and that count is the one number anyone checks.

`3P-ZON-03` **promotion-is-approval** — `MUST`: a card leaves `proposals/` for `tasks/` ONLY when
the authority its `min-approval-requirement:` names has approved it. Promotion writes ALL THREE
PLACES, in one commit (3P-ZON-10 · 3P-ZON-12):

- **frontmatter** — `column: proposal` → the entry column; `approved: false` → `approved: true`;
  `approval-judge:` = WHO decided; `approval-datetime:` = when; `updated:` bumped.
- **body** — an appended `## Approval log` line naming the approver, the requirement satisfied, and
  the RATIONALE. A card in `tasks/` asserts *someone with authority said yes*; with no logged reason
  that assertion has no evidence behind it and cannot be audited later.
- **the file** — `git mv` into `tasks/`.

`3P-ZON-04` **refusal-is-terminal-but-not-archival** — `MUST`: a refused proposal moves to
`refused/` with `column: refused`, `approved: rejected`, `approval-judge:`, `approval-datetime:`,
and `MUST NOT` be archived. `refused/` means NEVER approved; `archived/` means ONCE approved and now
finished — collapsing them destroys the distinction between *we decided not to* and *we did it*.
**The body `MUST` record the refusal per the R49 protocol**: the PRECISE DEFECT (a named command,
input path, or rule — "insufficiently secure" is not a finding), the BAR the proposal must clear to
be approvable, and an explicit invitation to re-propose. A bare "denied" is malpractice even when the
ruling is correct, because the proposer cannot read the approver's mind and will tear out the
dependent work instead of fixing the named defect.

`3P-ZON-05` **archive-eligible-set** — `MUST`: only `complete | completed | cancelled | superseded
| published | live` may enter `archived/`. **Every terminal column archives AS ITSELF** — no value
is rewritten on the way in. The rule's own original rationale decides this: `published`/`live` were
already exempt from renaming because a rewrite "destroys the fact that it SHIPPED", and the same
argument covers `complete` — the rename `complete → completed` carries ZERO information (the zone
is already encoded by the folder, and the `archived:` triple-consistency invariant beside
3P-ZON-12 holds with the enlarged set), while being a dual-write that was MEASURED drifting: 232 of 579 fleet archived cards
sat at `complete` across 8 repos on 2026-08-18, against 74 at `completed`, with 0 tool references
enforcing the old set (TRDD-36RGLVYH). `completed` remains legal — it is the folder-lifecycle
overlay value and 74 historical cards carry it — but archival `MUST NOT` rename into it; the
232 pre-amendment cards are conformant under this clause as amended, untouched, which is the only
remediation compatible with the terminal freeze (3P-ZON-07). *(Amended 2026-08-18 under direct USER
delegation to the hub session, recorded in TRDD-BRRJK57P's Approval log; spec-version 1.7.0→2.0.0
per 3P-VER-01, a MUST changed.)* An absent `release-via:` defaults to `none` (terminal `complete`). Archival
writes all three places (3P-ZON-12): frontmatter gains `archived: true` beside the terminal
`column:` and a bumped `updated:`; **the body `MUST` record the OUTCOME and WHY it is being
archived** — what shipped, what was abandoned and on whose call, or which card superseded it. An
archive entry whose body does not say why it ended is a file, not a record: the next reader can see
that it stopped and never why, which is the single question an archive is consulted for.

`3P-ZON-06` **failed-is-open** — `MUST NOT`: move a `failed` card to `archived/`. `failed` is an
OPEN, retryable state and stays in `tasks/`. Giving up on one is a DISTINCT act — `cancelled` — and
only that moves. An archived `failed` card is indistinguishable from work abandoned silently.

`3P-ZON-07` **terminal-freeze-boundary** — `MUST`: a card in `archived/` is frozen. Three clauses,
without which the rule forbids the very edit that closes a card: the closing edit is the LAST
PERMITTED write, not the first forbidden one; `## Approval log` is append-only and EXEMPT (an audit
trail that cannot record the act of closing is not an audit trail); and only `updated:` and
`superseded-by:` may change afterwards. New work is a NEW card.

`3P-ZON-08` **local-promotion** — `MUST`: promoting a LOCAL card to PROJECT moves the file with a
plain `mv` (LOCAL is in no repo, so `git mv` does not apply) and the card `MUST` keep its id — ids
are unique across BOTH roots (3P-TRDD-01), so nothing collides. **The move is the smallest part**:
3P-ZON-12 applies unchanged, and the body `MUST` record that the card changed SCOPE and why it now
matters to other contributors — a fact no field carries and no reader can reconstruct, since the
card's whole LOCAL history is invisible in the clone that receives it. **And promotion `MUST` be
refused while the card carries ANY outbound citation to a LOCAL card** (`parent-trdd`, `blocked-by`,
`npt`, `eht`): a PROJECT card citing a LOCAL one is a dangling reference for every other
contributor, who can never resolve a file absent from their clone. This is the one hard invariant
the scope split introduces, and it is greppable.

`3P-ZON-09` **the-wrapper-is-correctness-not-permission** — `MUST`: exactly ONE model governs zone
moves — *files are the source of truth, audited asynchronously*. A CLI that performs zone moves
(`aimaestro-trdd.sh` and successors) is a **correctness wrapper**: it exists to make 3P-ZON-03's
three edits atomically and consistently, and `MUST NOT` be described or relied upon as an
**authorization boundary**. The reason is structural, not political — any agent can write the file
directly with an editor, so a gate covering only callers who choose to use it is a suggestion with
extra steps. Authorization is enforced retrospectively (3P-ZON-11), never by the wrapper.

`3P-ZON-10` **zone-move-is-atomic** — `MUST`: the `column:` edit and the file move land in the SAME
commit. A commit carrying one without the other publishes a card whose zone and column contradict
(3P-ZON-02). That window is not theoretical: it is the exact defect the zone linter exists to catch,
and it has been committed in this repo.

`3P-ZON-11` **authorization-is-audited-not-gated** — `MUST`: a card's approval claim (`mandate:
true`, `mandated-by:`, `min-approval-requirement:`) is plain text its author controls, so it `MUST`
be verified against an OBJECTIVE floor recomputed from what the card actually TOUCHED — the changed
paths of the commits citing it — and `MUST NOT` be verified against the card's own declared floor,
which compares a claim to itself and passes trivially. The check is necessarily RETROSPECTIVE (the
objective evidence exists only once code lands); that is consistent with the model, not a weakness.
A watchdog scheduled NOWHERE satisfies nothing here — being scheduled is part of the clause.

`3P-ZON-12` **a-zone-move-writes-THREE-places** — `MUST`: every zone move updates the
**frontmatter**, the **body**, and the **file location**, together, in one commit. **A zone move is
not a file operation; it is the RECORD OF A DECISION**, and a `mv` alone records only that the
decision's consequence happened, never that it was made, by whom, or why.

- **frontmatter** carries the VERDICT, so it is machine-readable: `column:`, `approved:`
  (`false` → `true` | `rejected`), `approval-judge:`, `approval-datetime:`, `archived: true` on
  archival, and a bumped `updated:`.
- **the body** carries the REASONING, because no field can hold it: the rationale on promotion, the
  named defect and the bar on refusal (3P-ZON-04), the outcome and the why on archival (3P-ZON-05).
- **the location** carries the current state at a glance, and is what every `find`/`grep` sweep and
  every open-card count reads.

`archived:` is DENORMALIZED and therefore owes an invariant a checker can enforce:
`archived: true` ⟺ the file is in `archived/` ⟺ `column:` is in the 3P-ZON-05 set. Any two of the
three disagreeing is an ERROR, and `MUST NOT` be auto-resolved — which of them is true is a
judgment, and a tool that silently picks one loses the decision it was meant to preserve.

Rationale, because the shortcut is always available and always tempting: a card moved by `mv` alone
still *looks* correct in every listing — right folder, right column — and is unauditable forever
after. The evidence that an authority approved it, or that a human decided to abandon it, exists
only in the two places `mv` does not touch. **Ratified by the USER, 2026-08-05.**

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
| the 22-column vocabulary, TRDD/PRRD file formats, folder lifecycle | **IND** (the contract; this spec) |
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
