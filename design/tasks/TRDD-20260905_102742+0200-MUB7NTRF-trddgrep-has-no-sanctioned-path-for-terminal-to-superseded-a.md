---
trdd-id: MUB7NTRF
title: trddgrep has no sanctioned path for terminal to superseded, a transition rule 12 explicitly permits
column: todo
created: 2026-09-05T10:27:42+0200
updated: 2026-09-05T10:27:42+0200
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
---

# trddgrep has no sanctioned path for terminal to superseded, a transition rule 12 explicitly permits

IND base trdd-design-tasks.md step 12: on a terminal card only updated: and, when superseding, superseded-by: may change, and every terminal column archives AS ITSELF. So complete → superseded on an archived card is a permitted edit with no zone move. Measured 2026-09-05 while closing XXD62U6Z: `trddgrep move <archived> superseded --superseded-by X` refuses with "already terminal in archived"; `trddgrep set <id> column superseded` refuses with "a column change is half of a transition". `set superseded-by` works. Net: the one terminal-to-terminal edit the rule permits has no verb, so a checklist-less terminal card (TERMINAL-WITHOUT-CHECKLIST) can never be cleared through the sanctioned write path; G6A54OYK and 39OPYXQ9 carry that ERROR permanently despite successors PMDZ6L3H / MS3AD6NX existing. Do: let `move <id> superseded --superseded-by X` accept a card already in archived/ when the target is terminal and superseded-by resolves (column edit, no git mv, updated bumped). Test: the two cards above go to 0 ERRORs.

## Acceptance
- [ ] move accepts terminal → superseded on an archived card when --superseded-by resolves to a terminal card
- [ ] validate on G6A54OYK and 39OPYXQ9 shows 0 TERMINAL-WITHOUT-CHECKLIST after the move
- [ ] a test pins the transition and its refusal when --superseded-by is missing or open

## Approval log

- 2026-09-05T10:27:42+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
