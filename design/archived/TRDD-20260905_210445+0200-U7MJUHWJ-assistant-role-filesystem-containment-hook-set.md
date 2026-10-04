---
trdd-id: U7MJUHWJ
status: archived
title: ASSISTANT-role filesystem containment hook set
column: complete
created: 2026-09-05T21:04:45+0200
updated: 2026-10-04T18:34:43+0200
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
- [x] A newly-provisioned ASSISTANT cannot read or write any host file outside its workdir except the enumerated exceptions
- [x] The exception list is enforced as an allowlist (locally-scoped folders, approved project-scoped folders, the ASSISTANT's own files) — nothing outside it is reachable
- [x] The hook set installs automatically as part of ASSISTANT provisioning (TRDD-HB3OKWBN), never as a manual opt-in step

## Approval log

- 2026-09-05T21:04:45+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-04T18:34:43+0200 — COMPLETE by main-agent@ai-maestro. archived → complete.

## Implementation

2026-10-04 — implemented, commit 7f98793f1. Boxes 1-2 verified against tests/unit/assistant-fs-containment.test.ts (19 tests pass, real bash spawnSync of rules/aimaestro-hooks/assistant-fs-containment-guard.sh: blocks BOTH reads and writes outside workdir, allowlist-admits env-declared local+project folders while refusing a sibling-prefix dir, ignores heredoc bodies, fails closed with no workdir). Box 3 verified against the real wiring: lib/agent-invariants.ts:187 row 'assistant-fs-containment' (triggers create+wake+periodic) is invoked by enforceAgentInvariants at services/element-management-service.ts:10744 (CreateAgent G05 pipeline, trigger 'create'), services/agents-core-service.ts:2077 (wakeAgent, trigger 'wake'), and server.mjs:1933 boot sweep. Provisioning installs the hook automatically via that row; no manual opt-in. HB3OKWBN (auto-provision-on-registration) only governs WHO gets an ASSISTANT, not whether an ASSISTANT gets containment — that is this invariant, and it is live. Note: worker's report claimed it ticked these; the file read [ ]. Now resolved box-by-box. Closing to complete.
