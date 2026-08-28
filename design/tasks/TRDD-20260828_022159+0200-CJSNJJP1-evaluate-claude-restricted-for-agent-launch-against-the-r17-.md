---
trdd-id: CJSNJJP1
title: Evaluate claude --restricted for agent launch against the R17.24 whitelist
column: todo
created: 2026-08-28T02:21:59+0200
updated: 2026-08-28T02:21:59+0200
current-owner: hub-claude
created-by: hub-claude
task-type: spike
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T02:21:59+0200
---

# Evaluate claude --restricted for agent launch against the R17.24 whitelist

## Problem
Claude Code 2.1.248 added `--restricted` (`CLAUDE_CODE_RESTRICTED=1`): it removes the built-in tools that run commands or code plus `WebFetch` unless named in `--tools`, keeps file tools inside the working directory, REFUSES `bypassPermissions`, and IGNORES user, project and local settings files.

That last clause is the interesting one and the dangerous one. R17.24 enforces the agent plugin whitelist by writing `"<plugin>@<marketplace>": false` into each AGENT's own `.claude/settings.local.json` at wake — a mechanism that depends entirely on settings files being READ. Under `--restricted` they are ignored, so the whitelist would be neither enforced nor needed by that route: the restriction would come from the flag instead.

## Questions this spike must answer
1. Does `--restricted` ignoring local settings mean the R17.24 whitelist becomes redundant for restricted agents, or does it mean plugins load UNFILTERED because the disable list is ignored too? These have opposite implications and only measurement settles it.
2. `--restricted` refuses `bypassPermissions`. Which of this repo's launch paths pass `--dangerously-skip-permissions` — those two are mutually exclusive, so adoption is gated on each one.
3. Which built-in tools do our agents actually need? `--tools` is an allowlist, so the answer has to be enumerated per governance title, not guessed.

## Scope
A SPIKE — measure and write down the answer. No production launch path changes without a follow-up card, because getting this wrong either brick every agent or silently removes a guardrail.

## Acceptance
- [ ] measured: what a `--restricted` agent's plugin set actually is, against the R17.24 disable list
- [ ] the list of launch paths that would have to drop `--dangerously-skip-permissions` first
- [ ] a written recommendation: adopt, adopt-for-some-titles, or decline, with the reason

## Approval log

- 2026-08-28T02:21:59+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
