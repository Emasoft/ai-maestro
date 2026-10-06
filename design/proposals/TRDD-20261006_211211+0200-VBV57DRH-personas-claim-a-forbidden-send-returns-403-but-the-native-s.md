---
trdd-id: VBV57DRH
title: Personas claim a forbidden send returns 403 but the native session transport has no enforcement point
column: proposal
status: proposed
created: 2026-10-06T21:12:11+0200
updated: 2026-10-06T21:12:11+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Personas claim a forbidden send returns 403 but the native session transport has no enforcement point

## Problem
Every role-plugin persona told its agent that the communication graph is enforced server-side and a forbidden send returns 403. Since Claude Code 2.1.224 a second transport (cross-session SendMessage and ListAgents) bypasses the server, so the claim describes only one of two transports and an agent can route around its own comm graph believing the server has it covered. A fleet screen found 7 of 7 main personas asserting server enforcement and 0 of 7 naming the unpoliced transport; per-plugin fixes have since shipped and individual plugins report rows on the thread.
## Current open ask
Ask 1, canonical wording: none exists to copy; issue 143 is the candidate and is pending the owner. Ask 2: no rule text says whether R42.8 never an ASSISTANT binds the harness channel; governance-spec scopes R42.8 to block-state, read-prompt and answer on the CLI and server path only. Ask 3: R42.9 (crossSessionInbound refuse, fleet-wide, self-repairing) closes the untrusted inbound consequence but not the forbidden OUTBOUND send, which still auto-delivers; no mechanical lever exists for outbound yet. Decide whether an outbound enforcement point is possible or whether the answer is teaching only.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 131: verdict NONE, R42.8 mentioned in passing in 3QRUDK12 and MN0Q1IA2, gated on the 143 ruling.
Depends on the #143 ruling.
## Acceptance
- [ ] After the 143 ruling, the canonical wording is published where role-plugins can inherit it
- [ ] A decision is recorded on whether R42.8 reaches the native channel
- [ ] A decision is recorded on any outbound enforcement lever, or on teaching only
external-refs: Emasoft/ai-maestro issue #131 (https://github.com/Emasoft/ai-maestro/issues/131)

## Approval log
