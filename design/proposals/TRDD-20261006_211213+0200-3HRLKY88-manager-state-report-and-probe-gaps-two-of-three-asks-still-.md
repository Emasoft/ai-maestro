---
trdd-id: 3HRLKY88
title: MANAGER state report and probe gaps, two of three asks still pending
column: proposal
status: proposed
created: 2026-10-06T21:12:13+0200
updated: 2026-10-06T21:12:13+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: spike
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# MANAGER state report and probe gaps, two of three asks still pending

## Problem
Issue 130 asked for three things around the block-state probe and the MANAGER state report. The completed card LT5N2JA4 delivered the probe; two of the three asks are still pending per the last comment.
## Current open ask
Ask 1, four probe-shape gaps in block-state (hub answered per gap on 2026-08-29): lastError with a classification is a cheap yes (classifier over pane bytes already held); fleet all mode is a yes at O(N) pane captures; blockedSince is a no as a field because a duration cannot be derived from a snapshot and needs a persistence decision; the sources map is right in shape but needs two new integrations (janitor report, agentlenspro) as its own card. No timing commitment was made. Ask 2 (is issue 47 parked) is answered. Ask 3: notify the MANAGER when ai-maestro-plugin issue 59 (AskUserQuestion capture, measured 0 of 419 recorded) ships; still open as of the last check, so nothing to notify. The MAINTAINER added that a state without its cause is not actionable and that sources should carry measuredAt and the producing command.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 130: ONLY-ARCHIVED (LT5N2JA4 complete), 2 of 3 asks pending, partly resolved.
## Acceptance
- [ ] Decide and record: build lastError and fleet mode; decide whether blockedSince gets real persistence; scope the sources integrations
- [ ] Notify the MANAGER if ai-maestro-plugin issue 59 ships
external-refs: Emasoft/ai-maestro issue #130 (https://github.com/Emasoft/ai-maestro/issues/130)

## Approval log
