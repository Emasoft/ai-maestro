---
trdd-id: U7MJUHWJ
title: ASSISTANT-role filesystem containment hook set
column: todo
created: 2026-09-05T21:04:45+0200
updated: 2026-09-05T21:07:20+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: security
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:04:45+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# ASSISTANT-role filesystem containment hook set

## Problem
TRDD-3QRUDK12 mandates: "the hooks of the assistant will restrict even more the access to files outside the workdir, even for reads, except for certain locally scoped folders or project scoped folders or other files belonging to the very assistant or needed for collaborate to projects ... reading the host files outside of the workdir and outside of those exeptions, is strictly blocked by hooks and other permissions rules specific of the ASSISTANT role plugin." Auto-provisioning an ASSISTANT (TRDD-HB3OKWBN) opens a hole: a freshly-created ASSISTANT with no containment hooks installed could read or write host files far outside its workdir.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Build the ASSISTANT-role hook set that blocks reads AND writes outside the ASSISTANT's own workdir, with an enumerated exception list ONLY: designated locally-scoped folders, project-scoped folders (for approved collaborations per TRDD-U4KP0H92), the ASSISTANT's own files, and files needed for an approved collaboration. This closes the filesystem hole every newly-provisioned ASSISTANT opens until it is installed.

## Acceptance
- [ ] A newly-provisioned ASSISTANT cannot read or write any host file outside its workdir except the enumerated exceptions
- [ ] The exception list is enforced as an allowlist (locally-scoped folders, approved project-scoped folders, the ASSISTANT's own files) — nothing outside it is reachable
- [ ] The hook set installs automatically as part of ASSISTANT provisioning (TRDD-HB3OKWBN), never as a manual opt-in step

## Approval log

- 2026-09-05T21:04:45+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
