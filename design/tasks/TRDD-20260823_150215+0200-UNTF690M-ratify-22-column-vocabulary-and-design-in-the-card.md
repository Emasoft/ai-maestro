---
trdd-id: UNTF690M
title: ratify the 22-column kanban vocabulary and the design-in-the-card contract
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-23T15:02:15+0200
updated: 2026-08-23T16:39:16+0200
current-owner: ai-maestro-00
created-by: user
assignee: ai-maestro-00
task-type: infra
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-23T15:02:15+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
effort: XL
design-included: "false"
labels: [governance, kanban, three-pillars, column-vocabulary, prrd]
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-23

**What this card is now.** It began as "add 2 columns between todo and dev". The USER then
issued a SECOND directive the same day extending it to five new columns, a relocation of
`design`, a new design-in-the-card contract, and the creation of the project's first PRRD.
The card was renamed to match; the id `UNTF690M` is unchanged.

**Landed so far (verify by reading the files, not this list):**
- `design/requirements/PRRD.md` — CREATED. Golden rules `G1.1`–`G10.1`, carrying the USER's
  two directives verbatim. This project had NO PRRD before today.
- `design/specs/3-pillars-spec.md` — amended `2.0.0 → 3.0.0` (MAJOR, per 3P-VER-01: columns
  added). New/changed clauses: `3P-KAN-01/02/03/04/04a/04b/04c/05/10/12`, `3P-TRDD-13`, and
  the `@spec:kanban-columns` block bumped `v1 → v2`.

**Landed since:** all six workers verified first-hand; the gate wiring; the three-way fallback
(a SECOND USER directive, `PRRD G11.1`); and FOUR spec repairs that PEER SESSIONS found by
cross-reading the amendment against the corpus — none of which any test could have caught.

**NEXT ACTION.** Put the two open decisions to the USER (push authorization for 283 commits;
the two stale janitor-shipped global rules). Nothing else is blocked.

**THE PEER FINDINGS, because they are the most valuable output of this card:**

| # | Found by | Defect | Repair |
|---|---|---|---|
| 1 | ai-maestro-plugin | **Nothing is pushed.** I cited commit shas as though peers could fetch them; the branch is 283 ahead and the published state is 2026-08-21. Two peers had already "verified" against LOCAL trees, which would have made the error look confirmed. | Every later broadcast marks it unpushed; 9 earlier recipients corrected. |
| 2 | ARCHITECT | **The spec forbade 40% of its own board.** 3P-KAN-01 said "EXACTLY one of the N … no others" since 1.0.0 while the code accepted `VALID_COLUMNS` = 27. 70 of 176 cards carry a bracket value. PRE-DATES 3.0.0 by every version. | `3P-KAN-20` — board vocabulary (22) and legal `column:` set (27) are different sets. |
| 3 | ORCHESTRATOR | **`human_review` was a WORKING column that waits on a person.** 3P-KAN-10 and 3P-KAN-12 already disagreed about it pre-3.0.0; naming the resting principle made the omission visible. A correctly-parked card read as a stall with no `blocked-by:` it could honestly name. | `3P-KAN-10` — `human_review` joins the resting set. |
| 4 | ORCHESTRATOR | **A MUST I wrote hours earlier was unsatisfiable.** "Name the approver" named no field; zero cards carried one; four candidate field names measured absent. | `3P-KAN-22` — the approver is DERIVED (from the column, or from `min-approval-requirement:`, on 166/176 cards). No field minted: a value always derivable from another field is a second source of truth. |
| 5 | ARCHITECT | **My own grandfather clause had the SAME defect as #2** — `3P-KAN-21` named `todo` alone when THREE columns changed meaning. 14 more cards sat outside a boundary written for their situation. | `3P-KAN-21` widened to all three, with the opposite-direction drifts measured. |

**SUPERSEDED — do NOT carry forward:**
- ~~"insert TWO new columns"~~ — it is FIVE, and `design` also MOVES.
- ~~"17 → 19 columns"~~ — it is **17 → 22** (board), and the legal `column:` set is **27**.
- ~~the placement note asking which side of `design` the new columns go~~ — SETTLED by the
  USER's second directive.
- ~~`verify_assumptions` immediately precedes `dev`~~ — `dispatch` sits between them.
- ~~"`3P-KAN-04a/b/c`"~~ — malformed ids, invisible to the pillar grammar; renumbered 17/18/19.
- ~~"a card with no `column:` defaults to `todo`"~~ — three-way since `PRRD G11.1`.

**SUPERSEDED — do NOT carry forward:**
- ~~"insert TWO new columns"~~ — it is FIVE, and `design` also MOVES.
- ~~"17 → 19 columns"~~ — it is **17 → 22**.
- ~~the placement note asking which side of `design` the new columns go~~ — SETTLED by the
  USER's second directive: `design` moves BEFORE `todo`; `verify_assumptions`/`plan` sit
  AFTER `todo`.
- ~~`verify_assumptions` immediately precedes `dev`~~ — `dispatch` sits between them.

## Problem

Two gaps, both demonstrated in this repo the same day:

1. **Nothing forced a card's own claims to be CHECKED before they were built on.**
   TRDD-W6PHZFC9's evidence was corrected NINE times across seven adversarial reviews, every
   correction to a claim that had been asserted rather than measured — and in the last round a
   derivation from correctly-read code was still 2× off when the observation was one grep away
   in a file the card had already named.
2. **Nothing forced an implementation to be PLANNED before it was executed**, and nothing
   forced a plan to persist across sessions.

The USER's second directive added a third: **`design` sat AFTER `todo`**, so a card was
queued for work before anyone had designed it, and there was no approval column at all —
`backburner` was doing double duty as "not approved" and "deferred".

## The change

### 1. The vocabulary: 17 → 22 columns

```text
backburner → approval → design → design_ai_review → (design_human_review) → todo
  → verify_assumptions → plan → dispatch → dev → testing → ai_review → (human_review)
  → complete → publish → published  |  deploy → live → (live_auditing)
exception: blocked · failed · superseded
```

19 lifecycle + 3 exception. FIVE new (`approval`, `design_ai_review`, `design_human_review`,
`verify_assumptions`, `plan`); `design` RELOCATED from after `todo` to before it; nothing
removed. Ratified as `PRRD G2.1`, amended into the spec at 3.0.0.

### 2. Design lives in the card (`PRRD G5.1`, spec `3P-TRDD-13`)

No second file — the `ATRDD` sidecar idea is REVERTED (see the measurement below). The design
body goes in the SAME card, after the divider `<!-- @trdd:design-body -->`, at most one per
card. Four optional frontmatter fields carry the state: `design-included`, `design-approved`,
`first-design-draft`, `last-design-revision`. `trddgrep` gains `--design-body` /
`--no-design-body`.

## Decisions I made, and why — each is overridable by the USER in one line

These are recorded because the directive did not settle them and an unrecorded choice is
indistinguishable from an oversight.

| # | Decision | Ground |
|---|---|---|
| D1 | Enum identifiers are **snake_case** (`design_ai_review`), not the hyphens the directive spelled | MEASURED: all three pre-existing multi-word columns are snake_case (`ai_review`, `human_review`, `live_auditing`). A mixed enum invites typos no type-checker catches. The hyphenated forms are kept as the human-readable names in `PRRD G2.1`. |
| D2 | **`dispatch` is RETAINED**, at `plan → dispatch → dev` | The directive listed `plan → dev` and closed with "the rest remain the same". `dispatch` was between `design` and `dev`; when `design` moved it was orphaned rather than removed. Dropping a ratified column is destructive and was not requested. It also still has a job — ORCHESTRATOR assignment — after the plan exists. Cheap to reverse: **0 cards currently sit in `dispatch`** (measured). |
| D3 | `verify_assumptions` **plural** | The directive's list said `verify-assumption`, its own section heading said `VERIFY ASSUMPTIONS`. Plural matches the heading and the prose. |
| D4 | `approval` and `design_human_review` are **RESTING** columns (3P-KAN-10) | Both wait on a decision by another party. Calling them WORKING would make the drift detector scream at every correctly-parked card, which is how a detector gets ignored. |

## Verified before acting — the facts the directive asked me to check

- **"those were already added after the todo, i think, check"** — **TRUE for `design`.**
  `types/task.ts::DEFAULT_STATUSES` read `backburner, todo, design, dispatch, dev, …`, so
  `design` WAS after `todo`. It moves, as instructed.
- `verify_assumptions` / `plan` were **NOT** in any code enum — they existed only as this
  card's own unimplemented proposal. Nothing to move.
- **`approval`, `design_ai_review`, `design_human_review` did not exist** anywhere.
- **"revert the decision about a ATRDD extra file"** — `grep -rln "ATRDD"` over the whole repo
  returns **ZERO** files. There is no such decision recorded HERE to revert. `PRRD G5.1` and
  `3P-TRDD-13` now state the no-second-file rule positively, so the outcome is the one the
  directive asked for regardless of where that decision was made.
- **No `PRRD.md` existed** anywhere in the repo before today.
- `column: design` = 8 cards; `column: dispatch` = **0** cards (this is what makes D2 cheap).
- 157 open task cards + 19 proposals = **176 non-archived** cards in scope for the update
  mandate.

## Consequences — every consumer of the vocabulary

Measured with `grep -rln "live_auditing"` (a value unique to the enum):

| consumer | owner |
|---|---|
| `types/task.ts`, `types/team.ts`, `lib/kanban-field-authority.ts`, `app/api/agents/[id]/full/route.ts`, 4 vocabulary tests | worker 1 |
| `lib/trdd-doctor.ts`, `lib/trdd-create.ts` | worker 2 |
| `scripts/amp-kanban-{create-task,list,move}.sh`, `scripts/script-manifest.json`, `docs/SCRIPT-MANIFEST.md` | worker 3 |
| `rules/aimaestro/aimaestro-{trdd-approval,manager-approval-defaults,kanban-multiagent}.md` | worker 4 |
| `scripts/trddgrep.mjs` | worker 5 |
| `design/specs/3-pillars-spec.md`, `design/requirements/PRRD.md` | this session (DONE) |
| `.claude/project/memory/{three-pillars-conformance-spec,team-meeting-and-kanban}.md` | this session |

**NOT in this repo — the load-bearing external dependency.** The IND base
`~/.claude/rules/universal-kanban.md` states the vocabulary and is shipped GLOBALLY by the
**ai-maestro-janitor** plugin. It cannot be edited here; a project-local copy would be a
divergent mirror. Until the janitor ships 22, every session on this machine loads a rule
asserting 17 — and an agent "restoring the ratified baseline as-is" would read the stale
number as current. This is tracked as the coordination item in `## Acceptance`.

## Approval tier

`min-approval-requirement: user`, issued directly BY the USER, so it is a **mandate** and
needs no approval round-trip. `user` rather than `manager` because it amends a ratified
cross-repo spec, creates the project's golden-rule document, and changes a globally-shipped
IND rule — all above what a MANAGER may authorize alone.

## Acceptance

- [x] Column ORDER decided and written down before any consumer was edited.
- [x] `design/requirements/PRRD.md` created with `G1.1`–`G10.1` carrying the USER's directives
      verbatim.
- [x] `design/specs/3-pillars-spec.md` amended to 3.0.0 with a dated amendment note and the
      `@spec:kanban-columns` block bumped to v2.
- [x] The 22 columns landed in the canonical enum and every in-repo consumer. `DEFAULT_STATUSES`
      diffs BYTE-IDENTICAL against the spec's `@spec:kanban-columns` v2 block.
- [x] `3P-TRDD-13` implemented: divider convention, four frontmatter fields with agreement
      invariants in the doctor, `trddgrep --design-body` / `--no-design-body`.
- [x] Neuters recorded — FOUR, each restored byte-identical to HEAD and re-verified green:
      the doctor's design-field rule (2 red / 7 green); the trddgrep design-body split (7 and 3
      red); the governed-target wiring (3 red, **two of them BEHAVIOURAL** — driving the real
      `authorizeKanbanFieldWrite`, not the set); `defaultColumnForMissing` (8 red, 3 of them
      through the doctor's LINT MESSAGE, which is what proves the message and `--fix` share one
      definition).
- [x] The two transition tables carry authority for every new transition.
- [ ] **BLOCKED ON THE USER** — coordination with ai-maestro-janitor for `universal-kanban.md`.
      Not filed unilaterally (cross-project rule: file an issue, do not edit). A SECOND stale
      janitor rule was found by the ARCHITECT: `~/.claude/rules/trdd-approval-tiers.md` teaches
      the RETIRED `approval-tier:` field. The MAINTAINER then supplied the decisive evidence —
      it caused them to write `approval-tier: 2` into a real card the same day, while their own
      shipped persona asserts the live `min-approval-requirement:` enum. Not hypothetical drift.
- [x] Wikimem `three-pillars-conformance-spec` and `team-meeting-and-kanban` updated to 22,
      through `memgrep edit` (locked, CAS-guarded), `validate` + `lint` clean. A third page,
      `repo-file-structure`, was caught by the prose sweep.
- [x] All 20 peer sessions notified. 6 replied; 5 of those found real defects (table above).
      9 recipients received a CORRECTION after the unpushed-state defect was caught.
- [~] Mandate issued. In-repo it is **satisfied by `3P-KAN-21`**: ~76 affected cards are
      GRANDFATHERED and must NOT be swept; re-columning is per-card judgment for each owner.
      Cross-repo it does NOT bind — three peers correctly refused, and they were right: a peer
      message cannot carry a USER order across a repo boundary. The ARCHITECT delivered a
      read-only per-card report for its 23 instead: `reports/architect/20260823_163425+0200-3pillars-300-lane-reevaluation.md`.
- [x] Gates green, counts recorded: full suite **465 files / 6236 passed / 2 skipped, exit 0**;
      `yarn trdd:doctor` exit 1 with exactly the 2 pre-existing ledgered ERRORs
      (`TERMINAL-WITHOUT-CHECKLIST`, `BODY-STATE-CLAIM`) — unchanged, as required;
      `yarn pillars:lint` exit 0; `tsc --noEmit` 0 errors; spec clause census re-derived
      independently at **87**, KAN ids 01-22 contiguous with none reused.
- [x] Stale-prose sweep: 17 sites / 12 files, then a UNION sweep over FOUR independent needle
      families (old `14 lifecycle` breakdown, spell dictionaries, the reversed `todo → design`
      adjacency, bare `seventeen`) — all clean. Method from the MAINTAINER session: no single
      grep supports the word "exhaustive".

## Approval log

- 2026-08-23T15:02:15+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: the issuer is the only authority above `manager`, and this amends a ratified
  spec and a globally-shipped IND rule. No approval request was sent.
- 2026-08-23T16:10:41+0200 — SCOPE EXTENDED by a second USER directive the same day: four more
  columns, `design` relocated, the design-in-the-card contract, and the PRRD. Same mandate,
  same authority; card renamed to match, id unchanged.
