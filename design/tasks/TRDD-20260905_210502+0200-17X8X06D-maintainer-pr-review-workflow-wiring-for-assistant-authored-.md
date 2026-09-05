---
trdd-id: 17X8X06D
title: MAINTAINER PR-review workflow wiring for ASSISTANT-authored PRs
column: todo
created: 2026-09-05T21:05:02+0200
updated: 2026-09-05T21:07:22+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:05:02+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# MAINTAINER PR-review workflow wiring for ASSISTANT-authored PRs

## Problem
TRDD-3QRUDK12 mandates: an approved ASSISTANT "can clone the github repos of the project (a project can have multiple repos) and make PRs. the MAINTAINER agent delegated by the MANAGER to maintain the repo will review and eventually merge its PR or refuse asking to fix things. This is the only way an USER connected and registered remotely can collaborate to projects." No wiring exists today for a project's MAINTAINER to receive, review, and merge/refuse an ASSISTANT-authored PR as this sole collaboration path.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Wire the workflow so that, once the MANAGER approves a remote USER's ASSISTANT as a project collaborator (per TRDD-U4KP0H92's visibility grant), the ASSISTANT's cloned-repo PRs route to the project's MAINTAINER for review. The MAINTAINER merges or refuses with requested fixes; no other write path into the project's repos exists for the ASSISTANT.

## Acceptance
- [ ] An ASSISTANT's PR against a project repo is routed to that project's MAINTAINER agent for review
- [ ] The MAINTAINER can merge the PR or refuse it with a requested-fixes message, and the ASSISTANT sees the outcome
- [ ] No path exists for an ASSISTANT to merge its own PR or write directly to the project repo without MAINTAINER review

## Approval log

- 2026-09-05T21:05:02+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
