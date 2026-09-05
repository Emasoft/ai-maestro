---
trdd-id: XXD62U6Z
title: Two archived cards carry permanent validate ERRORs and the sanctioned repair is a user decision
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T04:58:53+0200
updated: 2026-09-05T05:03:28+0200
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

# Two archived cards carry permanent validate ERRORs and the sanctioned repair is a user decision

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

## What is settled, and what is still open

**Settled:** the repair IS sanctioned (below). **Still open:** the DECISION — whether repairing
two 2026-08-22 archived cards is worth the time.

**A claim was made, retracted, and the retraction then doubted — and the retraction turns out to
have been RIGHT, for a reason nobody had found yet.**

1. First asserted: *"permanently unfixable in place — rule 12 freezes terminal cards."* **False.**
   The freeze governs what may be edited *while* a card is terminal; it does not forbid moving a
   card out of a terminal column to repair it.
2. Then asserted: *"they ARE fixable."* **TRUE — but not established at the time**, which is a
   different thing. It rested on one line of linter output, and a correct conclusion from
   insufficient evidence is luck, not method. The evidence arrived at 05:03 (below).
3. Then doubted: *"neither version was established."* Correct about the *evidence* as it stood,
   and superseded by the clause found at 05:03.

What IS verified (`lib/trdd-doctor.ts`, read 2026-09-05 04:58):

- The remedy string at `:919` is *"Move it back to `<back>`, write the checklist, then close it"*.
- `back` (`:912`) = the card's `pre-block-column:` if set, else `'dev'` — a real pre-terminal
  column. It does **not** presuppose where the file lives.
- `boundaryNote` (`:908-910`) fires only when `updated:` is unparseable (the grandfather boundary
  could not be evaluated). It does **not** exclude archived cards.

So the linter's remedy is well-formed and location-agnostic in shape.

**SETTLED at 05:03: the move IS sanctioned, by a governing rule that prescribes it for EXACTLY
this defect.** `rules/aimaestro/aimaestro-trdd-approval.md:818` (the D4 watchdog, step 5b):

> *"a TRDD may sit in a terminal column … ONLY when its bottom checklist **EXISTS (≥1 box)** and
> every `- [ ]` box in it is `- [x]`. A terminal column with ANY unchecked box is a **false
> completion**, and so is a terminal column with **NO checklist at all** → **move it back to its
> `pre-block-column:` (or `dev`) and flag.**"*

`TERMINAL-WITHOUT-CHECKLIST` is that clause's second case, verbatim. The linter's remedy string
and this rule are the same instruction, and the rule is normative. So there is no gap: repairing
`G6A54OYK` and `39OPYXQ9` by moving them back, writing the checklist, and re-closing is the
**prescribed** handling, not an unsanctioned improvisation.

> ### ⚠ TWO WRONG ANSWERS PRECEDED THIS ONE, BOTH FROM A SEARCH TOO NARROW ON A DIFFERENT AXIS
>
> | attempt | instrument | verdict |
> |---|---|---|
> | 04:58 | `grep 'archived' trdd-design-tasks.md \| head -8`, **1 line read, 1 file** | "no clause addresses it" |
> | 05:01 | widened NEEDLE, still **2 files** (`trdd-design-tasks`, `trdd-approval-tiers`) | "absence survives; a gap, not a prohibition" |
> | 05:03 | same needle, **file set widened** to `universal-kanban.md` + this repo's two DEP overlays | **the clause exists — absence claim FALSE** |
>
> Each pass varied one dimension and left another too small: first the needle AND the file set,
> then only the needle. **The dimension not varied is the one that held the answer**, three times
> running. The 05:01 entry's "gap in the rules, not a prohibition" and its `tasks/` → `proposals/`
> "precedent" are both WITHDRAWN — the precedent framing was doing persuasive work it had not
> earned, and it is moot now that a direct clause exists.

**What remains open is ONLY the decision**, and it is a small one: whether two archived cards
from 2026-08-22 are worth the repair. The rules permit it; nobody is required to spend the time.

## Acceptance

- [x] Determine whether moving a card out of `design/archived/` is sanctioned — **YES.**
      `rules/aimaestro/aimaestro-trdd-approval.md:818` prescribes *"move it back to its
      `pre-block-column:` (or `dev`) and flag"* for a terminal column with no checklist — this
      exact defect. (Answered wrongly twice first; see the STATE block.)
- [ ] **USER DECISION — the only live branch.** Repair, or accept. Repairing means: move each
      card to its `pre-block-column:` (or `dev`), write the acceptance checklist recording what
      it promised and whether it delivered, re-close, re-archive; then `trddgrep validate`
      reports 0 ERRORs. Accepting means recording that here and closing this card, so the two
      ERRORs become a known-and-accepted floor rather than an unexplained recurring line.
      Both are legitimate; the rules permit the repair and nobody is obliged to spend the time.
- [x] ~~If sanctioned: repair both cards …~~ / ~~If NOT sanctioned …~~ — **STRUCK 05:03.** These
      were drafted as an either/or pair *before* box 1 had an answer. Once it did, one antecedent
      became permanently false, leaving a box that could never be truthfully ticked while the
      completion gate requires every box checked — the exact landmine removed from UAP7ZEJL's
      box 4 three commits earlier, reintroduced here. Collapsed into the single live decision
      above.
- [ ] The phrase "2 ERRORs, both pre-existing" in future commit messages cites this card instead
      of standing alone (the one box closable by my own behaviour — and missed in the two commits
      after this card was filed)

## Why this is a card and not a chat message

The claim and its retraction both happened in conversation and in commit messages. A commit
message is found by someone already investigating that commit; a chat reply may never be read at
all. Neither `G6A54OYK` nor `39OPYXQ9` carries a word about any of it. A card was the right
artifact for what was then an unresolved question — and it earned its keep immediately: filing it
forced the searches that resolved the question three passes later, which a chat reply would never
have prompted.

## Approval log

- 2026-09-05T05:03:28+0200 — **BOX 1 ANSWERED, AND THE 05:01 ANSWER WAS WRONG.** The 05:01 pass
  widened the NEEDLE and kept a two-file set; a review asked whether the FILE SET was now the
  narrow dimension. It was. Running the same needle over `universal-kanban.md` plus this repo's
  two DEP overlays found `aimaestro-trdd-approval.md:818` — the D4 watchdog clause prescribing
  *"move it back to its `pre-block-column:` (or `dev`) and flag"* for a terminal column with no
  checklist, which is this defect verbatim. **The repair is sanctioned.** Withdrawn with it: the
  "gap, not a prohibition" framing and the `tasks/` → `proposals/` precedent, which was doing
  persuasive work it had not earned.

  Also struck the dead either/or box pair (one antecedent became permanently false once box 1
  resolved — the same uncheckable-box landmine removed from UAP7ZEJL three commits earlier, and
  reintroduced here), retitled the card, and corrected the claim that *"they ARE fixable"* was
  unestablished: it was true, and unestablished, which are different things.

  **Method note, three passes running: the dimension NOT varied is the one holding the answer.**
  Pass 1 was narrow on needle and file set; pass 2 fixed the needle only; pass 3 fixed the file
  set and inverted the verdict.
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
