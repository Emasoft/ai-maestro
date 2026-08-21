---
trdd-id: CKLI8NWL
title: A MEMBER cannot be created in the wizard, and the team dialog cannot add one either
column: cancelled
min-approval-requirement: none
priority: 1
severity: high
effort: medium
task-type: bugfix
created: 2026-07-15T01:09:00+0200
updated: 2026-08-21T22:36:05+0200
scope: project
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
labels: [scenario-improvement, scen-029]
current-owner: scenario-runner
external-refs:
  - reports/scenarios-runner/SCEN-029_20260714T212851Z.report.md
---

# There is no way to create a team member in one pass

## Problem

Building a team through the UI is a deadlock that the user has to discover and
work around:

1. **The wizard cannot make a MEMBER.** At step 4 (title) with "No Team" chosen,
   the only enabled cards are AUTONOMOUS and MAINTAINER; every team title is
   disabled ("Requires team membership"). Correct per governance — but there is no
   team to pick yet, because…
2. **Create Team's "Team Roles" step does not offer the agent.** The 5-step dialog
   (Team Info → GitHub Repos → GitHub Project → Team Roles → Confirm) creates the
   team and auto-creates the COS, but the AUTONOMOUS agent never appeared as a
   selectable member, so the team is created with the COS alone.
3. **The team dashboard's "Add Agent" picker was outright broken** (fixed this run —
   see BUG-001 / commit `f34432a2`: `useTeam.updateTeam` used a plain `fetch` against
   a strict route and got an unrecoverable 403).

So the only path that works today is: create the agent AUTONOMOUS → create the team →
open the team dashboard → Add Agent → sudo → the ChangeTeam pipeline auto-transitions
the title to `member`. Three surfaces, one of which was non-functional.

SCEN-029's own steps encode the impossible order (S006 "create the MEMBER", S007
"create the team"), which is how the deadlock surfaced.

## Root cause

The title gate is per-agent and evaluated at wizard time, while team membership is
established afterwards by a different pipeline. Nothing in the wizard offers
"create this agent INTO a team", and Create Team's roles step appears to list only
agents that are already eligible, which a brand-new standalone agent is not.

## Proposed fix

Pick one and make it the sanctioned path:

- **(a) Let the wizard target a team.** If a team is selected at step 3, enable the
  team titles at step 4 and have CreateAgent perform the ChangeTeam transition. This
  is what the wizard's step order already implies.
- **(b) Fix Create Team's roles step** to list every AUTONOMOUS agent as an
  addable member, so a team can be born with its members.

(a) is the smaller change and matches the wizard's existing shape. Either way, the
"Add Agent" picker on the team dashboard stays as the after-the-fact path.

## Verification

Create `scen0xx-member` and put it in a team without ever visiting a third surface;
`GET /api/teams` shows it in `agentIds` and its `governanceTitle` is `member`.
Then re-run SCEN-029's S006/S007 as written (the scenario file should be corrected
to whichever path is chosen).

## Estimated risk

MED — it touches the CreateAgent gate order and the title-eligibility rules, which
are governance-load-bearing. The gates must still refuse a team title for an agent
that ends up in no team.

## Approval log

- 2026-08-21T22:36:05+0200 — CANCELLED by ai-maestro-hub-session (min-approval-requirement: none). Re-measured: option (a) is implemented. `components/AgentCreationWizard.tsx` — picking a team at the team step sets `selectedTeamId`; `handleTeamSelect` then defaults the title to `'member'` (`const defaultTitle: AgentRole = teamId ? 'member' : 'autonomous'`); the title step offers `TEAM_TITLES` (member/chief-of-staff/orchestrator/architect/integrator) whenever a team is selected; the create payload carries `teamId: selectedTeamId`. A MEMBER can now be created into a team in one wizard pass, no third surface required. The "Add Agent" picker bug (BUG-001/`f34432a2`) this card also names was already fixed in the same run per the card's own text. Repaired, not declined.
