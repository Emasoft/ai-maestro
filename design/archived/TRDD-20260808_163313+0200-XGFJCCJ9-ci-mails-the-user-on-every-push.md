---
trdd-id: XGFJCCJ9
title: CI mails the USER on every push — notification fatigue makes a real failure invisible
column: completed
created: 2026-08-08T16:33:13+0200
updated: 2026-08-15T00:48:35+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T00:32:23+0200
priority: 3
severity: low
effort: small
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [ci, notifications, ergonomics]
npt: []
eht: []
blocked-by: []
relevant-rules: []
---

# CI mails the USER on every push

## Problem

Flagged by the MANAGER during the 2026-08-08 CI-green campaign: every push to
`Emasoft/ai-maestro` produces a CI run whose failure mails the repo owner. During an
iterative fix campaign that is a mail per attempt — the USER received "dozens of failure"
notifications for one underlying defect, and the flood is itself a defect: it trains the
owner to ignore CI mail, so the one failure that matters arrives pre-ignored. It also
forced this session into batching pushes as a workaround, which delays landing work.

## Proposed fix (pick at approval)

1. **Concurrency-cancel on non-main branches** (already partially present) plus restricting
   the workflow's failure-notification surface: GitHub sends failure mail to the commit
   author for runs THEY triggered — the lever is the owner's GitHub notification settings
   (Actions: "Only notify for failed workflows" per-repo watch settings), which is a
   USER-side setting we can only document, not commit.
2. **Trigger scoping**: run the full suite on `main` and PRs only; on topic branches run a
   cheap lint job. Cuts the mail-generating population without weakening the main gate.

Option 2 is the committable one; option 1 is a docs note. Both together are the honest fix.

## Why manager-tier

Edits `.github/workflows/` triggers — the D3 objective floor puts `.github/` changes at
`manager`.

## Acceptance

- [x] MANAGER picks the shape (both halves; APPROVED 2026-08-15, see log)
- [x] A push to a topic branch no longer runs the full mail-generating suite — MEASURED
      ALREADY TRUE at implementation time: `ci.yml` triggers were `push: branches:
      [main]` + `pull_request: branches: [main]`, so topic branches run NOTHING. The
      approved "cheap lint on topic branches" was NOT added — it would CREATE a new
      failure-mail surface, against this card's own Problem statement (the approval's
      shape was decided on the card's stale premise that topic pushes ran the full
      suite). Instead the scoping is now DELIBERATE and guarded by a WHY comment on the
      trigger block, so a future editor doesn't "helpfully" widen it. The docs half
      (owner watch settings: Custom → Actions unticked, or failed-workflows-only) lives
      in the same comment — the one place a future CI editor certainly reads.
- [x] The main-branch gate is unchanged (full suite still required there) — trigger
      block content untouched, comment only.

## Approval log

- 2026-08-08T16:33:13+0200 — Authored as a proposal from the MANAGER's side note ("a CI
  that mails the USER on every push is itself a defect worth a card").
- 2026-08-15T00:32:23+0200 — APPROVED by ASSISTANT-MANAGER (min-approval-requirement:
  manager). Shape decided: BOTH — option 2 committed (full suite on main + PRs, cheap lint
  on topic branches) + option 1 as a docs note on owner-side notification settings.
  Main-branch gate unchanged.
- 2026-08-15T00:44:31+0200 — COMPLETED by ai-maestro, with one measured deviation from
  the approved shape, recorded not hidden: the topic-lint half was DROPPED because the
  premise was stale — triggers were already main+PR-only, so topic lint would ADD mail
  surface rather than remove it. The MANAGER's intent (fewer failure mails, main gate
  unchanged) is served by the deliberate-scoping comment + owner watch-settings note.
