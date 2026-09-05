---
trdd-id: XXD62U6Z
title: Two archived cards carry permanent validate ERRORs and it is unsettled whether the prescribed remedy applies to them
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T04:58:53+0200
updated: 2026-09-05T05:01:17+0200
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

**`trddgrep validate` reported the same 2 ERRORs in every run of the 2026-09-05 session (~a
dozen), and this card exists so the phrase "2 ERRORs, both pre-existing" stops being a deferral
nobody has to justify.** (An earlier draft said "on every run for as long as anyone has looked" —
cut, because their history was never examined; both cards are dated 2026-08-22, so the true span
is at most two weeks and possibly far less. Over-reach in prose, in a card about over-reach.)

| card | column | rule |
|---|---|---|
| `G6A54OYK` (2026-08-22) | `completed` | `TERMINAL-WITHOUT-CHECKLIST` |
| `39OPYXQ9` (2026-08-22) | `complete` | `TERMINAL-WITHOUT-CHECKLIST` |

Both sit in `design/archived/`. Both post-date the 2026-07-31 grandfather boundary, so the gate
flags them deliberately rather than by oversight.

## What was settled at 05:01, and what is still open

**Settled:** the rules-search question (below). **Still open:** the DECISION — whether repairing
two 2026-08-22 archived cards is worth doing given that no clause sanctions the move.

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

**Whether un-archiving is sanctioned — searched properly at 05:01, and the answer is NUANCED.**

> ⚠ The first draft of this section asserted the absence from `grep -rn 'archived'
> trdd-design-tasks.md | head -8`, of which **one line was read**. That was one file of at least
> two: `trdd-design-tasks.md` has exactly **1** line matching `archived`, while
> `trdd-approval-tiers.md` — which legislates the archival protocol and movement *between*
> terminal states — has **18**, and was never grepped at all. The needle was also wrong: a
> permitting clause need never use the word "archived". Re-run with
> `un-?archiv|restore|move (it )?back|reopen|out of .?design/archived` across BOTH files.

Three hits, and **none addresses moving a card out of `design/archived/`**:

| hit | what it actually governs |
|---|---|
| `trdd-design-tasks.md:83` | `pre-block-column:` — restore a **blocked** card when its blocker clears |
| `trdd-design-tasks.md:128` | `unblock-when:` — `trdd-drift` auto-restores a **blocked** card |
| `trdd-approval-tiers.md:553` | the D4 watchdog moving an under-classified card **`tasks/` → `proposals/`** |

So the absence claim SURVIVES the widened search — **and the third hit makes the question sharper
rather than merely open.** The corpus DOES sanction a reverse folder move (`tasks/` →
`proposals/`, to un-authorize a card), so reverse moves are not categorically forbidden; the
archive specifically is *unaddressed*. That is a gap in the rules, not a prohibition — which is a
materially different starting point for whoever decides this than "no clause exists".

A tool prescribing a column change is still not a rule sanctioning a folder move back out of the
archive. But the precedent for reverse moves exists one folder over.

## Acceptance

- [x] Determine whether moving a card out of `design/archived/` is sanctioned — **no clause
      addresses it** (widened search across both governing files, 05:01; see the STATE block).
      The corpus sanctions ONE reverse move — `tasks/` → `proposals/` at
      `trdd-approval-tiers.md:553` — so this is an unaddressed gap, not a prohibition
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

- 2026-09-05T05:01:17+0200 — Box 1 CLOSED by widened search. This card was filed at 04:58 and a
  review immediately found its THESIS rested on a partial instrument: `grep -rn 'archived'
  trdd-design-tasks.md | head -8`, one line read, one file of two — and
  `trdd-approval-tiers.md` (18 matching lines, the file that actually legislates the archival
  protocol) was never opened. The needle was wrong too: a permitting clause need never say
  "archived". Fourth partial-instrument universal of the session, and the first where the
  conclusion itself was at stake rather than a supporting adjective — a card whose reason for
  existing is *"this is unresolved"* is worthless the moment it turns out to be resolved
  somewhere unread. The re-run confirms the absence and adds the `tasks/` → `proposals/`
  precedent, which makes this a GAP rather than a prohibition. Also cut "for as long as anyone
  has looked" to the measured span.
- 2026-09-05T04:58:53+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: records an open question about this project's own board hygiene and performs no
  repair. The repair itself, if it happens, is a separate decision recorded above.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
