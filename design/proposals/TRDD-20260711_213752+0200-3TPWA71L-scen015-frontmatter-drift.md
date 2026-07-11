---
trdd-id: 3TPWA71L
title: SCEN-015 frontmatter drift — deprecated chrome-devtools required_tools and cleanup gaps
column: proposal
created: 2026-07-11T21:37:52+0200
updated: 2026-07-11T21:37:52+0200
current-owner: scenario-runner
assignee: null
priority: 3
severity: LOW
effort: S
task-type: docs
labels: [scenario-improvement, scen-015]
relevant-rules: []
min-approval-requirement: chief-of-staff
external-refs: ["reports/scenarios-runner/SCEN-015_2026-07-11T18-33-14Z.report.md"]
---

## Problem

SCEN-015's frontmatter still carries `required_tools:` listing the deprecated
`mcp__chrome-devtools__*` tools (deprecated for scenario runs since 2026-04-15,
per the runner spec), and lacks the `browser_stack: dev-browser` field that Rule
8 now mandates. Its Phase 2/3 steps also assume the runner drives `amp-send.sh`
directly — which, per the Rule 0 reinforcement this run, the human user (the
runner's role) must NOT do; the message must be issued through the agent's Chat
section instead.

## Root cause

The scenario predates (a) the 2026-04-15 dev-browser mandate and (b) the Rule 0
clarification that the runner is the human user and cannot run agent-to-agent CLI
tooling itself. Both left the step text describing an actor (the runner-as-agent)
that no longer exists.

## Proposed fix

- File: `tests/scenarios/SCEN-015_amp-end-to-end-messaging.scen.md`.
- Replace `required_tools:` with `browser_stack: dev-browser`.
- Rewrite S012/S016/S019 so the *action* is "instruct agent <X> via its Chat
  section to run amp-send.sh/amp-reply.sh" and the *verify* stays the allowed
  read-only path (`find ... inbox`, `amp-inbox.sh`/`amp-read.sh` as inspection).
- Add a prerequisite note that the agents' client must be logged in for the
  round-trip to complete (this machine's `dotenclave` keychain must be unlocked),
  and that the runner does NOT run amp-send itself.

## Verification

Re-read the scenario: no `mcp__chrome-devtools__*` token remains; `browser_stack:
dev-browser` present; every message-send step routes through Chat, every verify
step is read-only.

## Estimated risk

LOW — scenario-authoring only, no product code.

## Approval log
