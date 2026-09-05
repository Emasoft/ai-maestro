---
trdd-id: 3RIWC3FI
title: Capture a live AskUserQuestion menu frame as a fixture so the continuity matcher can be written from it
column: todo
created: 2026-09-05T11:33:12+0200
updated: 2026-09-05T11:34:26+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: artifact
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:33:12+0200
---

# Capture a live AskUserQuestion menu frame as a fixture so the continuity matcher can be written from it

TRDD-U6AS2YWB (the AskUserQuestion continuity event) has all of its machinery landed (770880b1, d530ec7b, 80e927a6, e7fdf068) and its unit gaps closed on 2026-09-05, but its `ask-user-question` event MATCHER cannot be written: the card forbids guessing the TUI copy, and no live-captured AskUserQuestion frame exists anywhere in the repo or fixtures. This card is that capture — operator / scenario-runner territory, not a lean-worker unit: drive a real Claude Code session into an AskUserQuestion menu (a prompt that makes it call the AskUserQuestion tool), capture the rendered tmux pane with the same idiom `defaultContinuityDeps().captureFrame` uses (visible-only capturePane), and commit the frame as a fixture next to the existing continuity fixtures under tests/unit/. Then U6AS2YWB can write the matcher from the fixture and run its driven end-to-end box.

## Acceptance

- [ ] a rendered AskUserQuestion menu frame captured from a LIVE Claude Code session (not typed from memory) is committed as a fixture under tests/unit/ with its capture date and Claude Code version in a comment
- [ ] the capture shows both the menu body and the idle prompt line that follows dismissal, so the matcher and the cursor-ready poll can both be written from it
- [ ] U6AS2YWB's blocked-by is cleared by the coordinator when this card closes

## Approval log

- 2026-09-05T11:33:12+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:34:26+0200 — column → todo by manager. Operator/scenario-runner task carved out of U6AS2YWB: its matcher cannot be written without a live-captured frame. Authorization: USER /goal 2026-09-05.
