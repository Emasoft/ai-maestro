---
trdd-id: UNTF690M
title: add verify-assumptions and plan columns between todo and dev
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-23T15:02:15+0200
updated: 2026-08-23T15:02:15+0200
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
labels: [governance, kanban, three-pillars, column-vocabulary]
external-refs: []
---

## Problem

The ratified kanban vocabulary runs `todo → design → dispatch → dev`. Nothing between `todo` and
`dev` forces a card's own claims to be CHECKED before they are built on, and nothing forces an
implementation to be PLANNED before it is executed. Both gaps were demonstrated in this repo the
same day this card was written: TRDD-W6PHZFC9's evidence was corrected **nine times** across seven
adversarial reviews, every correction to a claim that had been asserted rather than measured — and
in the last round a derivation from correctly-read code was still **2× off** when the observation
was one grep away in a file the card had already named.

## The change

Insert TWO new columns between `todo` and `dev`:

```
… backburner → todo → verify_assumptions → plan → design → dispatch → dev → testing …
```

Column identifiers are snake_case to match the existing enum (`ai_review`, `human_review`,
`live_auditing`), so the values are **`verify_assumptions`** and **`plan`**. The vocabulary grows
from **17 to 19** columns (16 lifecycle + 3 exception).

> **Placement note to settle before implementing.** The USER's directive names the boundary as
> "between `todo` and `dev`". The enum has `design` and `dispatch` in that span already. The
> ordering above puts verification and planning BEFORE `design`, on the reasoning that an
> architect should not decompose a card whose facts are unverified. If the intended order is
> `todo → design → dispatch → verify_assumptions → plan → dev`, that is a one-line change to this
> section and to the transition table — but it must be DECIDED and written down here before any
> consumer is touched, because the two orderings produce different transition tables and a
> half-migrated enum is worse than either.

### VERIFY ASSUMPTIONS

Verify every piece of information reported in the TRDD. **Assume nothing as true.** Where a fact
cannot be checked directly, CREATE A TEST that verifies the claim. The column passes only when
every claim and assumption in the TRDD has been verified true.

### PLAN

Plan the implementation by executing the exact planning steps of Claude Code's **plan mode**,
except non-interactively: instead of consulting the user, make every choice AUTONOMOUSLY and base
each decision on verified facts or tests. The plan must be:

- **detailed**, and optimized to consume as few tokens as possible without compromising quality;
- built on **rigorous TDD** procedures, breaking macro steps into micro actionable steps;
- gated — a **strict quality gate per micro-step**;
- **parallelism-aware**: identify every parallelizable micro-step and redesign the workflow
  sequence so those can be sped up by spawning parallel subagents acting on DIFFERENT files;
- explicit about whether Claude Code's **scripted dynamic workflows** should execute the
  parallelized micro-steps, using **fork agents sharing one context** so the cache is not
  rewritten.

Passes only when the complete implementation plan for the TRDD exists as a written plan file.

### DEV (amended, not replaced)

`dev` keeps its current meaning and gains one obligation: **the plan steps produced by `plan` are
enforced.** They must be executed, and their execution verified, as instructed by Claude Code's
own plan-mode prompt, so that they PERSIST ACROSS SESSIONS.

## Consequences — every consumer of the 17-column enum

The vocabulary is CANONICAL and consumers align TO it, so this is a coordinated change, not a
local edit. Measured with `grep -rln "live_auditing"` (a value unique to the enum):

| consumer | what changes |
|---|---|
| `lib/kanban-field-authority.ts` | the enum itself |
| `lib/trdd-doctor.ts` | `COLUMN-UNKNOWN` accepts the two new values; any terminal/ordering logic |
| `lib/trdd-create.ts` | default/allowed columns |
| `app/api/agents/[id]/full/route.ts` | API surface |
| `scripts/amp-kanban-create-task.sh`, `-list.sh`, `-move.sh` | CLI vocabulary |
| `scripts/script-manifest.json` | manifest |
| `design/specs/3-pillars-spec.md` | the ratified spec (needs a version bump + amendment note) |
| `rules/aimaestro/aimaestro-trdd-approval.md` | the Part B2 transition-authority table |
| `rules/aimaestro/aimaestro-manager-approval-defaults.md` | the EXEMPT/NON-EXEMPT transition lists |

**NOT in this repo, and this is the load-bearing dependency:** the IND base
`~/.claude/rules/universal-kanban.md` states the 17-column vocabulary and is shipped GLOBALLY by
the **ai-maestro-janitor** plugin. It cannot be edited here — a project-local copy would be a
divergent mirror. That change must be coordinated with the janitor repo, or the two halves of the
fleet will disagree about what a legal column is.

## Approval tier

`min-approval-requirement: user`, and the USER issued it directly, so it is a **mandate** and
needs no approval round-trip. Recorded as `user` rather than `manager` because the D3 floor puts
governance-file edits at `manager` and this ALSO amends a ratified cross-repo spec plus a
globally-shipped IND rule — above what a MANAGER may authorize alone.

## Verification

- `trddgrep validate` and `yarn trdd:doctor` accept a card at each new column and still reject a
  nonsense one (guards the enum widening did not become a hole).
- A card can be moved `todo → verify_assumptions → plan → …` through the CLI and the doctor stays
  clean at every step.
- `yarn pillars:lint` passes against the amended spec.
- The full suite is green.

## Acceptance

- [ ] Column ORDER decided and written into this card (see the placement note above) before any
      consumer is edited.
- [ ] `verify_assumptions` and `plan` added to the canonical enum in `lib/kanban-field-authority.ts`.
- [ ] All 9 in-repo consumers listed above updated, each verified by a test or a run.
- [ ] `design/specs/3-pillars-spec.md` amended with a version bump and a dated amendment note.
- [ ] The two transition tables updated with authority for the new transitions.
- [ ] Coordination opened with the ai-maestro-janitor repo for `universal-kanban.md`, and its
      outcome recorded here — the fleet must not split on the column vocabulary.
- [ ] A test pins that a card cannot reach `dev` without passing through `plan`, and cannot reach
      `plan` without passing through `verify_assumptions`, since a gate nothing enforces is prose.
- [ ] Neuter recorded for that test.
- [ ] `yarn trdd:doctor`, `trddgrep validate`, `yarn pillars:lint` and the full suite all green,
      with counts recorded here.

## Approval log

- 2026-08-23T15:02:15+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: the issuer is the only authority above `manager`, and this amends a ratified spec
  and a globally-shipped IND rule. No approval request was sent.

## Implementation

(not started — this card is filed at `todo`, per the pipeline it is itself proposing to change)
