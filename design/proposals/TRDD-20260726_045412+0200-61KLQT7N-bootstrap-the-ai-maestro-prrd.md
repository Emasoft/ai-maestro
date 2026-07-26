---
trdd-id: 61KLQT7N
title: Bootstrap the ai-maestro PRRD — the missing top pillar of its own 3-pillars system
column: proposal
scope: project
project-id: ai-maestro
created: 2026-07-26T04:54:12+0200
updated: 2026-07-26T04:54:12+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: user
mandate: false
approved: false
relevant-rules: [R25, R51]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## Problem

**ai-maestro has no PRRD.** Verified three independent ways on 2026-07-26:

```bash
find . -iname 'PRRD*.md'        # → nothing
ls -la design/requirements/     # → the DIRECTORY does not exist
command -v get-prrd.py prrd-edit.py findprrd.py   # → all three ABSENT
```

This is the top pillar of the three-pillars system, missing in the project that **defines and ships
that system to every other agent**:

- `rules/aimaestro/aimaestro-prrd-governance.md` is a DEP overlay ai-maestro seeds into every
  registered agent workdir. It specifies the per-title PRRD authority matrix and the COS-routed
  proposal queue — for a document this repo does not have.
- The IND base `~/.claude/rules/prrd-design-rules.md` loads in every session and declares
  `<project-root>/design/requirements/PRRD.md` git-tracked and never gitignored.
- `design/specs/README.md` gates spec approval on PRRD-compliance: *"a spec that contradicts a PRRD
  requirement is refused"*. With no PRRD that gate cannot be evaluated for ANY spec in the folder —
  recorded as `AIO-MNT-03` in `design/specs/all-in-one-spec.md`.
- R25 (Three-Pillars Task System) is `DOC-ONLY` in the enforcement map's Part II.

So the pillar is absent, its tooling is absent, and one approval gate silently passes because there
is nothing for it to check. "No PRRD to contradict" is not "verified compliant".

## Why this is a PROPOSAL and not a Tier-0 task

GOLDEN rules are **USER-set and immutable to everyone else** — the IND base is explicit that not even
the MANAGER may add, revise, promote or demote one, and `prrd-edit.py` enforces it with
`403 — golden rules are user-only`. A PRRD is a project's constitution.

Authoring one unilaterally would mean an agent inventing the constitutional rules that bind it, while
building the very machinery meant to enforce that it cannot. That is not a process technicality: it
is the single failure that would discredit every gate in TRDD-DQ6XN2VP. Hence
`min-approval-requirement: user`, and hence this sits in `design/proposals/` until the USER rules.

## Proposed fix

Three separable steps; only step 2 needs the USER.

**1. Structure (Tier 0 once approved).** Create `design/requirements/PRRD.md` with the IND-base
frontmatter (`project-id: ai-maestro`) and the two empty tiers, plus the `design/requirements/`
folder. No rules yet — an empty constitution with a correct shape is honest; a populated one an agent
wrote is not.

**2. The GOLDEN rules (USER only).** The IND base names ONE recommended baseline, and ai-maestro
already enforces its substance as R22:

> **G1** — every agent writing to GitHub (issue, comment, PR, review, discussion, release note) MUST
> begin the body with a one-line self-identification of which agent/role/plugin authored it, because
> all AI Maestro agents share the single human-owner GitHub identity. Commits SHOULD carry an
> `Agent: <plugin-slug>` trailer.

It is GOLDEN precisely because it is an anti-impersonation convention the MANAGER must not be able to
weaken. Beyond G1, the USER decides. Candidates worth *considering* — proposed for consideration, not
asserted: the R16 password-never-shared invariant; the R50.4 bypass prohibition; the
`~/agents/`-workdir boundary. Each is currently a rule in `docs/GOVERNANCE-RULES.md` marked
`IRON, USER-set`, which is the same authority claim in a different artefact — and that duplication is
itself a question for the USER (see the open question below).

**3. The tooling.** `get-prrd.py --init`, `prrd-edit.py`, `findprrd.py` are referenced by the DEP
overlay and by `aimaestro-manager-approval-defaults.md` §X but are not installed. Either install them
(they belong to the janitor's IND surface, so this is a janitor coordination item, not an in-repo
build) or record that ai-maestro edits its PRRD by hand and the overlay's `$AID_AUTH` enforcement
path is aspirational here.

## The open question the USER should answer first

`docs/GOVERNANCE-RULES.md` already carries 51 rules, several tagged `CRITICAL — IRON, USER-set`. A
PRRD would introduce a SECOND artefact claiming USER-set authority over project rules. Per
`3P-META-02`'s logic, two artefacts asserting the same authority is how drift starts. So:

- **(a)** Does the PRRD hold a small number of genuinely constitutional rules while
  `GOVERNANCE-RULES.md` stays the operational catalogue? (Recommended: the two have different jobs —
  a constitution is short and rarely changes; a catalogue is long and evolves.)
- **(b)** Or is `GOVERNANCE-RULES.md` *already* ai-maestro's PRRD in all but name and location, in
  which case the fix is to say so explicitly rather than create a second file?

**(b) is a legitimate answer and would close this TRDD without creating anything.** It is recorded
first-class here so the outcome is not biased toward "build the thing".

## Verification

- `design/requirements/PRRD.md` exists, is git-tracked, and is NOT gitignored.
- Every rule carries the IND-base identity `<letter><number>.<version>` with globally-unique numbers.
- `scripts/aio-gate-coverage.py` re-run: R25's row reflects the change.
- `design/specs/all-in-one-spec.md` `AIO-MNT-03` updated — the gap it records is closed or
  re-scoped.
- If (b) is chosen: `AIO-MNT-03` and `design/specs/README.md` are amended to name
  `docs/GOVERNANCE-RULES.md` as the PRRD-equivalent, and this TRDD is archived as `cancelled`.

## Estimated risk

LOW to build, MEDIUM to get wrong. The risk is not technical — it is authoring constitutional rules
with the wrong authority, or creating a second source of truth for project rules. Both are avoided by
the USER answering the open question before step 2.

## Approval log

_(empty — awaiting USER)_
