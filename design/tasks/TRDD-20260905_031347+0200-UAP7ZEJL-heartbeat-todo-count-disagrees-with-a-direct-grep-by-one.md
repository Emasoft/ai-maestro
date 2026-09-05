---
trdd-id: UAP7ZEJL
title: The heartbeat todo count and a direct grep disagree by exactly one card
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-05T03:13:47+0200
updated: 2026-09-05T03:18:15+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: unassigned
task-type: bugfix
priority: 2
severity: low
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-05T03:13:47+0200
blocked-by: []
npt: []
eht: []
labels: [kanban, board-reporting, measurement]
---

# The heartbeat todo count and a direct grep disagree by exactly one card

## ⏵ STATE — READ THIS FIRST — 2026-09-05

**Two numbers the project runs on differ by one, and neither has been shown wrong.** ⚠ Note what
that does NOT assert: an earlier draft of this card said "one of the two is wrong and nobody knows
which", and that assumes both instruments answer the SAME question. They may not — if the
heartbeat deliberately excludes a card the grep includes, **both are correct answers to different
questions** and nothing is broken. Deciding which case this is IS the card. Measured minutes apart
on 2026-09-05:

| instrument | value |
|---|---|
| janitor heartbeat, `open board: N in todo` | **51** |
| `grep -l '^column: todo$' design/tasks/*.md \| wc -l` | **52** |

**The gap survived a board mutation, which is what makes it structural rather than a timing
artifact.** Before moving TRDD-0GCIMQ9F out of `todo` the pair read 52 / 53; after, 51 / 52. Both
instruments moved by exactly one and stayed one apart.

**RULED OUT — the other zones.** `design/proposals/`, `design/archived/` and `design/refused/`
contain **zero** files with `column: todo`, so the heartbeat is not counting a wider corpus than
`design/tasks/`. That was the obvious explanation and it is dead.

**NOT DIAGNOSED, DELIBERATELY.** I guessed once already this session — I claimed the two
instruments "agree, just measured a move apart" — and that was false. A second guess would be
worse than an open question, so this card records the measurement and stops. The most likely
remaining hypothesis, untested: the heartbeat applies a predicate the grep does not — a card
parked by a future `review-after:`, a drift filter, or a scope/`project-id` restriction.
**That is a hypothesis, not a finding.**

## Why this is worth a card rather than a note

Every heartbeat prints a todo count, and this session made board-state claims from it repeatedly.
If it is off by one, every such claim inherits the error; if the grep is off by one, so does every
manual audit. One of the two is wrong and nobody knows which.

It is cheap to settle: find the heartbeat's counting code, run its predicate against the same 52
files, and name the one card the two sets disagree about. The reproduction is already written down
above.

## Acceptance

- [ ] The heartbeat's todo-counting code is located and its predicate stated here
- [ ] The exact card the two instruments disagree about is named, by id
- [ ] Whichever instrument is wrong is fixed, OR the difference is documented as intended
      (with the reason), so a future reader does not re-open this
- [ ] If the heartbeat is correct and the grep naive, the correct manual command is recorded
      in this card so audits stop using the wrong one

## Approval log

- 2026-09-05T03:13:47+0200 — MANDATE issued by claude-opus-session (min-approval-requirement:
  none). Tier-0: a read-only measurement discrepancy inside this project's own board tooling.
  Pre-approved: issuer authority >= required approver. No approval request was sent.
