---
trdd-id: XNW6THVC
title: AQTGAY60 and OWO449MR appear to disagree about where the G09b plugin-record cleanup sits
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T01:34:47+0200
updated: 2026-09-05T01:37:54+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: unassigned
task-type: docs
priority: 3
severity: low
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-05T01:34:47+0200
blocked-by: []
npt: []
eht: []
labels: [corpus-consistency, deleteagent, aio-pipeline]
---

# AQTGAY60 and OWO449MR appear to disagree about where the G09b plugin-record cleanup sits

## ⏵ STATE — READ THIS FIRST — 2026-09-05

**This card asserts a DISAGREEMENT, not a verdict. It does NOT say which side is stale, because
I have not read OWO449MR — only AQTGAY60's DESCRIPTION of it.** Naming a stale side from a
second-hand description is the error this card exists to stop someone repeating.

**The two claims, as written. ⚠ BOTH COLUMNS BELOW QUOTE AQTGAY60; NEITHER WAS READ FROM SOURCE**
— including the OWO449MR row, which is AQTGAY60's description of it. The detail is specific enough
to read as verified and is not; that is the whole reason this card exists rather than a verdict.

| card | what it says about the plugin-record cleanup |
|---|---|
| **TRDD-AQTGAY60** (`human_review`) | its "what is actually in the tree" table places **G09b inside the hard-delete-with-folder branch, right AFTER the workdir is removed** — and its acceptance box 2 argues that placement is *load-bearing*: running after the folder is gone is what makes every `{scope:'local', projectPath: resolvedDir}` record provably FALSE, which is why the gate deliberately has no compensation |
| **TRDD-OWO449MR** (`completed`, archived) | AQTGAY60 describes it as relocating that cleanup to **BEFORE** the workdir is deleted, because the `claude plugin uninstall --scope local --cwd` it substitutes for the hand-edit needs the workdir to still exist |

**Both cannot be current.** And the disagreement is not cosmetic: AQTGAY60's no-compensation
argument depends on the AFTER placement. If OWO449MR moved it BEFORE, that argument no longer
holds and the gate's missing compensation becomes an open question again.

**NEXT ACTION — one grep settles it.** Read the actual placement of the `removeLocalInstallRecords`
call in `DeleteAgent` (`services/element-management-service.ts`) relative to the workdir removal,
then read OWO449MR itself. Fix whichever card is stale. If OWO449MR's relocation landed, re-open
AQTGAY60's box 2.

**Why this is its own card rather than a note — and the justification is ADDRESSABILITY, not
visibility.** A new `todo` card among 52 is not meaningfully more visible than a note on a parked
card; that framing would be close to false. What extraction actually buys: an **id that can be
cited, blocked-on and grepped** (`grep -l XNW6THVC`), and a row in the board count the heartbeat
prints every fire. Prose has none of those.

The deeper reason is standing: **the note impugns the correctness of the card it was living in.**
AQTGAY60's box 2 is ticked on an argument this contradiction may invalidate, so a footnote saying
"this card's checked box may be unearned" has no standing there — and a reader going top-to-bottom
has already accepted box 2 before reaching it.

**Residual, named rather than glossed: filing this RESOLVES NOTHING.** Queueing is a handoff, not
a resolution (the kanban rule this project runs under says so explicitly), and this card discharges
its finding only when something pulls it.

**Provenance.** Surfaced by adversarial review during the 601KG45D/AQTGAY60 session
(2026-09-05); inherited into that session's context rather than measured, which is exactly why
the next step is to read both files.

## Acceptance

- [ ] The real placement of the `removeLocalInstallRecords` call relative to the workdir removal
      is read from `services/element-management-service.ts` and stated here with a line number
- [ ] TRDD-OWO449MR is read directly (not via AQTGAY60's description) and its actual claim quoted
- [ ] Whichever card is stale is corrected — noting that OWO449MR is `completed`/archived and
      therefore FROZEN, so a correction there is a new card, not a body edit
- [ ] If the relocation landed, AQTGAY60's box 2 (the no-compensation argument) is re-opened,
      because that argument rests on the AFTER placement

## Approval log

- 2026-09-05T01:34:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only corpus-consistency audit inside this project's own design corpus.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
