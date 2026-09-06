---
trdd-id: 6B1ND5TD
title: SCEN-015 S012 S016 S019 Action fields wait on the agent clock inside a runner step (Rule 15)
column: todo
created: 2026-09-06T02:15:58+0200
updated: 2026-09-06T02:15:58+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: docs
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T02:15:58+0200
---

# SCEN-015 S012 S016 S019 Action fields wait on the agent clock inside a runner step (Rule 15)

## Problem
`tests/scenarios/SCEN-015_amp-end-to-end-messaging.scen.md` steps S012, S016 and S019 end their `- **Action:**` field with "Wait for Alice/Bob to run the command in its own terminal and report back in Chat". That is a wait on the AGENT's clock inside a runner step — the shape Rule 15 (SCENARIOS_TESTS_RULES.md, THE-RUNNER-NEVER-WAITS) forbids: a subagent that ends its turn to wait is reported as finished, so the run is abandoned mid-scenario (three SCEN-031 runners died this way; Rule 15 records SCEN-014 S020/S024 as the same shape). Pass 2 of TRDD-3TPWA71L (commit 7dc15819) rewrote those Action texts to state a goal instead of a pasted argv and deliberately left this wait standing — its commit message disclaims Rule 15 conformance.

## Proposed fix
Split each of the three steps into (a) the UI burst — type the Chat directive, screenshot, exit — and (b) a separate verify step whose precondition is "the agent has ALREADY reported back in Chat", stated at the top in a form the runner checks in one cheap call, with the exact `BLOCKED: <precondition>` string to return when unmet. The orchestrator owns the clock between (a) and (b). Do not touch the Goal/Verify fields' script names (the observer's checks).

## Acceptance
- [ ] No `- **Action:**` line in SCEN-015 contains "Wait for" followed by an agent name or "to run the command"
- [ ] Each former wait step has a precondition line and a `BLOCKED:` string
- [ ] `yarn pillars:lint` rc 0 after the edit

## Approval log

- 2026-09-06T02:15:58+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
