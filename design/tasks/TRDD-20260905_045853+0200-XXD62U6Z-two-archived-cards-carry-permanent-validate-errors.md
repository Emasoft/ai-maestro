---
trdd-id: XXD62U6Z
title: Two archived cards carry permanent validate ERRORs and it is unsettled whether the prescribed remedy applies to them
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T04:58:53+0200
updated: 2026-09-05T04:58:53+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: unassigned
task-type: bugfix
priority: 3
severity: low
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-05T04:58:53+0200
blocked-by: []
npt: []
eht: []
labels: [trdd-tooling, board-hygiene, open-question]
external-refs: [TRDD-UAP7ZEJL]
---

# Two archived cards carry permanent validate ERRORs and it is unsettled whether the prescribed remedy applies to them

## ⏵ STATE — READ THIS FIRST — 2026-09-05

**`trddgrep validate` has reported the same 2 ERRORs on every run for as long as anyone has
looked, and this card exists so the phrase "2 ERRORs, both pre-existing" stops being a deferral
nobody has to justify.** It was quoted roughly a dozen times in one session's commit messages.

| card | column | rule |
|---|---|---|
| `G6A54OYK` (2026-08-22) | `completed` | `TERMINAL-WITHOUT-CHECKLIST` |
| `39OPYXQ9` (2026-08-22) | `complete` | `TERMINAL-WITHOUT-CHECKLIST` |

Both sit in `design/archived/`. Both post-date the 2026-07-31 grandfather boundary, so the gate
flags them deliberately rather than by oversight.

## The open question — and it is genuinely open in BOTH directions

**A claim was made and retracted in the same session, and neither version was established.**

1. First asserted: *"permanently unfixable in place — rule 12 freezes terminal cards."* **False as
   stated.** The freeze governs what may be edited *while* a card is terminal; it does not by
   itself forbid moving a card out of a terminal column to repair it.
2. Then asserted: *"they ARE fixable."* **Also not established** — replacing a false certainty
   with its opposite on one line of evidence.

What IS verified (`lib/trdd-doctor.ts`, read 2026-09-05 04:58):

- The remedy string at `:919` is *"Move it back to `<back>`, write the checklist, then close it"*.
- `back` (`:912`) = the card's `pre-block-column:` if set, else `'dev'` — a real pre-terminal
  column. It does **not** presuppose where the file lives.
- `boundaryNote` (`:908-910`) fires only when `updated:` is unparseable (the grandfather boundary
  could not be evaluated). It does **not** exclude archived cards.

So the linter's remedy is well-formed and location-agnostic in shape.

**What is NOT verified: whether un-archiving is sanctioned by the folder-lifecycle rules.** The
IND base (`trdd-design-tasks.md`) describes the flow into `design/archived/` and says every
terminal column archives AS ITSELF; a grep of that rule for `archived` turns up the folder list
and the archival direction, and **no clause either permitting or forbidding the reverse move**.
That is the gap. A tool prescribing a column change is not the same as a rule sanctioning a
folder move back out of the archive.

## Acceptance

- [ ] Determine whether moving a card out of `design/archived/` is sanctioned — cite the clause,
      or record that no clause addresses it
- [ ] If sanctioned: repair both cards (move to `back`, write the acceptance checklist that
      records what each promised and whether it delivered, re-close, re-archive) and confirm
      `trddgrep validate` reports 0 ERRORs
- [ ] If NOT sanctioned, or if the user judges two 2026-08-22 cards not worth un-terminalling:
      record that decision HERE and close this card, so the two ERRORs are a known-and-accepted
      floor rather than an unexplained recurring line
- [ ] Either way, the phrase "2 ERRORs, both pre-existing" in future commit messages should cite
      this card instead of standing alone

## Why this is a card and not a chat message

The claim and its retraction both happened in conversation and in commit messages. A commit
message is found by someone already investigating that commit; a chat reply may never be read at
all. Neither `G6A54OYK` nor `39OPYXQ9` carries a word about any of it. The correct artifact for
an unresolved question is a card recording the question — not a settled answer in either
direction, which is what both previous attempts produced.

## Approval log

- 2026-09-05T04:58:53+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: records an open question about this project's own board hygiene and performs no
  repair. The repair itself, if it happens, is a separate decision recorded above.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
