---
trdd-id: 3I9Y0NYK
title: Launch plan, two day-0 criteria unmet, R42.8 end-to-end run and live approval flow
column: proposal
status: proposed
created: 2026-10-06T21:12:16+0200
updated: 2026-10-06T21:12:16+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: spike
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Launch plan, two day-0 criteria unmet, R42.8 end-to-end run and live approval flow

## Problem
Issue 63 is the MANAGER's dedicated launch-plan issue (four questions A to D). Ask B, the day-0 definition-of-done for the MANAGER plugin and what it owns on day 1, was drafted by the hub and ratified on 2026-08-08 under delegated owner authority. Ask A (the date and window) remains with the owner; ask C sequencing and the ask D go/no-go gate list are only partly answered (the 46 credential-rejection half was resolved; the server-woken end-to-end run is still an untested gate).
## Current open ask
The MANAGER reported status on the six ratified day-0 criteria: 4 met (1 governance incorporation current at v5.3.3, 4 coordination as sequencing, 5 published and installable at v2.16.0, 6 outbound discipline). 2 not met: criterion 2, the R42.8 unblock procedure (block-state, read-prompt, answer) has never been demonstrated end-to-end against a genuinely blocked agent (needs a stalled target or a sanctioned way to create one, and read-prompt is blind to AskUserQuestion until ai-maestro-plugin issue 59 ships); criterion 3 is partial, the approval flow has never been exercised against a live inbound approval request from a peer under the ratified tiers. Nothing else is blocked on the hub.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 63: ONLY-ARCHIVED (HT6GTHPQ complete), no live launch card, 4 of 6 day-0 criteria met, 2 not.
## Acceptance
- [ ] A genuine blocked-agent run of the R42.8 procedure with transcript
- [ ] A live inbound approval request handled under the ratified tiers
- [ ] The owner supplies ask A, the launch date and window
external-refs: Emasoft/ai-maestro issue #63 (https://github.com/Emasoft/ai-maestro/issues/63)

## Approval log
