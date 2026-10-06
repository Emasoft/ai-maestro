---
trdd-id: X2TO8B7C
title: Correct the R42.3 factual clause now false since Claude Code 2.1.224 and add the inbound authority half
column: proposal
status: proposed
created: 2026-10-06T21:12:11+0200
updated: 2026-10-06T21:12:11+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: user
scope: project
project-id: ai-maestro
approved: false
---

# Correct the R42.3 factual clause now false since Claude Code 2.1.224 and add the inbound authority half

## Problem
Rule R42.3 asserts a fact about transports that stopped being true when Claude Code 2.1.224 shipped a direct session-to-session SendMessage channel that does not traverse the AI Maestro server. The rule is USER-tier (IRON, USER-set): nobody below USER may correct it, so this card is a request for the USER to draft or approve the correction. The authority ban inside the rule is not in question and should not move.
## Current open ask after the thread
The thread widened it from one clause to two. (1) Outbound routing: replace the factual sentence with the transport-agnostic wording adopted on the thread, that R6 constrains the RECIPIENT, not the transport, and a route forbidden over AMP is forbidden over cross-session SendMessage too, because the host cannot see the R6 graph. The correction should also say the second transport is unpoliced in both directions. (2) Inbound authority: a cross-session message arrives with no server identity check and no AID, so it cannot confer authority however it signs itself; the authority is the USER directive, never the message's claim about who sent it. A later comment folded in the Claude Code 2.1.225 to 2.1.232 delta (session-name uniqueness is not safety, ListAgents offline labels are a MAY, removed friction argues for more caution, remote start-by-name widens reach); none of it changes the argument. Note the thread cites a card id RGAQCQN6 that does not exist in this repo.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 143: verdict NONE, only a passing mention in BRRJK57P, awaiting a USER ruling. Several role-plugins already ship the transport-agnostic phrasing in their personas.
## Acceptance
- [ ] USER rules on the replacement R42.3 text covering both outbound and inbound halves
- [ ] The rule text and its governance-spec clause are updated together by the USER-authorised path
- [ ] The issue is closed with the ruling quoted
external-refs: Emasoft/ai-maestro issue #143 (https://github.com/Emasoft/ai-maestro/issues/143)

## Approval log
