---
trdd-id: XNW6THVC
title: AQTGAY60 and OWO449MR appear to disagree about where the G09b plugin-record cleanup sits
scope: project
project-id: ai-maestro
column: complete
created: 2026-09-05T01:34:47+0200
updated: 2026-09-05T02:21:52+0200
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

## ⏵ STATE — RESOLVED 2026-09-05T02:21 — AQTGAY60 was the stale side

**Both sources are now read from source, and they agree with each other against AQTGAY60.**
The relocation LANDED. Measured:

| claim | measured |
|---|---|
| the gate | **`G08c`**, `services/element-management-service.ts:9510`, inside the AIO sequence and **BEFORE** `G09`'s folder delete at `:9656-9668` |
| tombstone | `:9674` — *"G09b USED TO SIT HERE … It is now G08c, inside the gate sequence and BEFORE this deletion"* |
| `removeLocalInstallRecords` | **DOES NOT EXIST.** One tree-wide hit, a comment at `:1716` saying it used to. It is now read-only `listLocalInstallRecords` (`:1732`), called at `:9548` |
| compensation | present — `undo: compensateG08c` (`:9603`) |
| OWO449MR | `column: completed`, archived, CORRECT. STATE: *"`G09b` → **`G08c`**, inside the gate sequence, BEFORE `G09`'s folder delete, using the CLAUDE adapter with a CLI-reinstall compensation."* (`f1e4d7ec`, `5861db3b`) |

**THIS CARD'S OWN NEXT ACTION CARRIED THE BUG IT WAS FILED ABOUT.** It told the reader to grep for
the placement of the `removeLocalInstallRecords` call — a symbol deleted in `f1e4d7ec`. The card
was written from AQTGAY60's description instead of from source, so it inherited the dead symbol
along with the stale placement. Refusing to name a stale side was right; the framing around that
refusal was still second-hand.

**What was actually wrong on AQTGAY60 turned out to be larger than a stale table.** Three further
defects surfaced only because the grep was run: a paragraph that spent the stale placement to
**overturn and tick an acceptance box** (box 2, since re-opened and then re-closed on the real
compensation); boxes 3-4 citing `tests/unit/deleteagent-g09b-plugin-records.test.ts`, **which does
not exist** (renamed with the gate; the real file is `deleteagent-g08c-plugin-uninstall.test.ts`,
8 tests); and box 4's cited neuter runs (`34849d8d`) having been run against the deleted file, so
they pin nothing current — box 4 is now un-ticked.

> Superseded framing, kept because it records why the card refused to guess: *"This card asserts a
> DISAGREEMENT, not a verdict. It does NOT say which side is stale, because I have not read
> OWO449MR — only AQTGAY60's DESCRIPTION of it."* That restraint was correct and is what made the
> resolution cheap — one grep, no rework.

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

- [x] The real placement is read from `services/element-management-service.ts` and stated with a
      line number — **`G08c` at `:9510`, BEFORE `G09`'s folder delete at `:9656-9668`** (tombstone
      `:9674`). The box named `removeLocalInstallRecords`; that symbol does not exist — the call is
      read-only `listLocalInstallRecords` at `:9548`
- [x] TRDD-OWO449MR is read directly (not via AQTGAY60's description) and its actual claim quoted —
      `design/archived/TRDD-20260730_125910+0200-OWO449MR-installed-plugins-json-via-the-cli.md`,
      `column: completed`; quoted verbatim in the STATE table above
- [x] Whichever card is stale is corrected — **AQTGAY60 was stale, and it is `human_review`, not
      terminal, so a body edit is legal**. Corrected: the tree table, the withdrawn box-2 rebuttal,
      the STATE supersession line, and boxes 1-4. OWO449MR needed no correction, so the
      frozen-archive caveat never came into play
- [x] If the relocation landed, AQTGAY60's box 2 is re-opened — re-opened, **then re-closed on
      evidence**: `G08c` registers `undo: compensateG08c` (`:9603`), so the box is met on the terms
      it originally asked for rather than the substituted placement argument. Box 4 was un-ticked
      in the same pass (its cited test file does not exist and its neuters ran against the deleted
      one)

## Approval log

- 2026-09-05T01:34:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only corpus-consistency audit inside this project's own design corpus.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T02:21:52+0200 — COMPLETED by claude-opus-session. All four boxes answered from
  source; AQTGAY60 corrected in place (it is `human_review`, not terminal). No code changed —
  the code was already right; only the card describing it was wrong.
