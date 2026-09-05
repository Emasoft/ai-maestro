---
trdd-id: MUB7NTRF
title: trddgrep has no sanctioned path for terminal to superseded, a transition rule 12 explicitly permits
column: complete
created: 2026-09-05T10:27:42+0200
updated: 2026-09-05T11:30:49+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T10:27:42+0200
implementation-commits: [ea2aca7c]
---

# trddgrep has no sanctioned path for terminal to superseded, a transition rule 12 explicitly permits

IND base trdd-design-tasks.md step 12: on a terminal card only updated: and, when superseding, superseded-by: may change, and every terminal column archives AS ITSELF. So complete → superseded on an archived card is a permitted edit with no zone move. Measured 2026-09-05 while closing XXD62U6Z: `trddgrep move <archived> superseded --superseded-by X` refuses with "already terminal in archived"; `trddgrep set <id> column superseded` refuses with "a column change is half of a transition". `set superseded-by` works. Net: the one terminal-to-terminal edit the rule permits has no verb, so a checklist-less terminal card (TERMINAL-WITHOUT-CHECKLIST) can never be cleared through the sanctioned write path; G6A54OYK and 39OPYXQ9 carry that ERROR permanently despite successors PMDZ6L3H / MS3AD6NX existing. Do: let `move <id> superseded --superseded-by X` accept a card already in archived/ when the target is terminal and superseded-by resolves (column edit, no git mv, updated bumped). Test: the two cards above go to 0 ERRORs.

## Acceptance
- [x] move accepts complete|completed → superseded on an ARCHIVED card when --superseded-by resolves to any existing card (open or terminal) and --reason names the checklist gap; REFUSES when the source is published, live or failed (a release-pipeline statement — R-Y makes force-supersede NON-EXEMPT)
- [x] validate on G6A54OYK and 39OPYXQ9 shows 0 TERMINAL-WITHOUT-CHECKLIST after the move
- [x] a test pins the transition and its refusal when --superseded-by is missing or open

## Approval log

- 2026-09-05T10:27:42+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:30:49+0200 — COMPLETE by manager. Verb landed in ea2aca7c (archiveTrdd in-place complete->superseded, 8 tests, worker neuter reddened exactly those 8, PATH-verified on a temp fixture). Box 2 applied by the coordinator: G6A54OYK->PMDZ6L3H and 39OPYXQ9->MS3AD6NX superseded in place; validate 7 -> 5 (0 TERMINAL-WITHOUT-CHECKLIST). The two successor artifacts stay archived as complete; their inherited ticks are recorded in this card's Artifacts section. Authorization: USER /goal 2026-09-05 'complete all TRDD and pending tasks'..

## Artifacts of the 2026-09-05 attempt — clean up when the verb exists
Two successor cards were minted and completed before the verb gap was measured: PMDZ6L3H (a born-complete proxy for the throwaway smoke card G6A54OYK — no work, one box citing the original's log) and MS3AD6NX (for 39OPYXQ9; box 1 measured this session, boxes 2-4 INHERITED from the original's prose, not re-run). Both are now terminal in archived/ and the tool refuses cancel/uncheck on them. The half-edit that set superseded-by on the originals without the column transition was REVERTED (a state no rule describes). When this verb lands: supersede G6A54OYK by nothing (cancel PMDZ6L3H), and re-run MS3AD6NX's three inherited boxes or cancel it too.
