---
trdd-id: XCQ9TDSK
title: trddgrep move out of blocked leaves blocked-by populated, which the 3-pillars spec calls drift
column: backburner
created: 2026-09-05T11:25:38+0200
updated: 2026-09-05T11:25:38+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: bugfix
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:25:38+0200
---

# trddgrep move out of blocked leaves blocked-by populated, which the 3-pillars spec calls drift

`trddgrep move <id> complete` on a `blocked` card renames it into archived/ and sets the column but leaves `blocked-by:` populated. Measured 2026-09-05 on DQVPODKW (blocked-by [1LFRP6GJ], moved blocked→complete after 1LFRP6GJ closed): the next `trddgrep validate` raised GRAPH-DANGLING-BLOCKER on a now-frozen card, and the repair had to be a `set blocked-by '[]'` on a terminal card plus an approval-log line (5d400f01, e64d448d). design/specs/3-pillars-spec.md:297 already rules the state the tool produced: "`blocked-by:` naming a TERMINAL card is not a licence — it is drift". The invariant is `blocked-by` non-empty ⟺ `column: blocked` (3P-KAN-06); a move OUT of `blocked` into any column must therefore clear the field as part of the same closing edit, the way the blocked→pre-block-column restore already does. Memory: ATOM-N9Y2-EFZH on trdd-conventions. Start after TRDD-MUB7NTRF lands — both change the same `move` verb source.

## Acceptance

- [ ] `trddgrep move` out of `blocked` into ANY column (terminal or working) clears `blocked-by:` and names the cleared blockers in the appended approval-log line
- [ ] a test pins blocked→complete on a fixture card: blocked-by empty afterwards, and a neuter that skips the clear reddens exactly that test
- [ ] `trddgrep validate` on a fresh blocked→complete move raises no GRAPH-DANGLING-BLOCKER

## Approval log

- 2026-09-05T11:25:38+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
