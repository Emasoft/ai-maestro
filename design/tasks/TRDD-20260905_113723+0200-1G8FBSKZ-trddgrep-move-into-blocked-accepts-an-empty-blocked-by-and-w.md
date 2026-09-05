---
trdd-id: 1G8FBSKZ
title: trddgrep move into blocked accepts an empty blocked-by and writes no pre-block-column
column: todo
created: 2026-09-05T11:37:23+0200
updated: 2026-09-05T11:37:25+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: bugfix
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:37:23+0200
---

# trddgrep move into blocked accepts an empty blocked-by and writes no pre-block-column

Sibling of TRDD-XCQ9TDSK (the EXIT path). `advanceColumn` INTO `blocked` (lib/trdd-store.ts:755-835) enforces nothing on the way in: measured 2026-09-05, `trddgrep move U6AS2YWB blocked` succeeded with `blocked-by: []` (committed that way in 7f9429a5 after an empty-variable parse) and wrote no `pre-block-column`, so the next validate raised BLOCKED-NO-RESTORE-POINT (052524f9). 3P-KAN-06 makes `blocked-by` non-empty ⟺ `column: blocked`, and `pre-block-column` is the restore point the exit path blanks — a card parked without one has nowhere to return to. Fix in `advanceColumn`: when the target is `blocked`, refuse (exit 2, message citing 3P-KAN-06) unless `blocked-by` is non-empty OR the card carries one of the doctor's other park forms (`review-after`, the hub-blocked/fleet-ask label); and write `pre-block-column: <current column>` when absent. Sequence after XCQ9TDSK lands — same function, same file.

## Acceptance

- [ ] `trddgrep move <id> blocked` with an empty `blocked-by` and no other park form refuses with exit 2 and a message naming 3P-KAN-06
- [ ] `trddgrep move <id> blocked` writes `pre-block-column` = the column the card left, and validate raises no BLOCKED-NO-RESTORE-POINT afterwards
- [ ] tests pin both, and a recorded neuter (drop the refusal) reddens exactly the refusal test

## Approval log

- 2026-09-05T11:37:23+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:37:25+0200 — column → todo by manager. Tier 0 sibling of XCQ9TDSK (entry path). Authorization: USER /goal 2026-09-05.
