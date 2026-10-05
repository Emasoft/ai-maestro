---
trdd-id: VR4OPNVI
title: Rulings needed on what a chair may do to superiors and peers
column: proposal
status: proposed
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:25:39+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: user
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
approved: false
relevant: [TRDD-A50RC5G8]
---

# Rulings needed on what a chair may do to superiors and peers

## Problem

Split out of TRDD-A50RC5G8 (2026-10-05). Questions only the USER can decide, collected while binding chief-of-staff authority to the registry. Nothing here is to be implemented before an answer. Where the code already takes a position, it is marked INTERPRETATION with how to overrule it.

1. INTERPRETATION (3a78439f6): a chair may not change the title of a MANAGER or an ASSISTANT listed in its team. Overrule: delete the two-title deny in the COS change-title branch of lib/authorization.ts and its two tests.
2. INTERPRETATION (96245c34c, 5ce4c6a5a): the MANAGER cannot be seated as a team's chair. Basis read by the orchestrator: R4.3 "MANAGER and MAINTAINER are not in any team" + R4.6 "COS must be a member of the team". Overrule: delete the managerId check in validateTeamMutation and in cross-host assign-cos, and their tests.
3. CONTRADICTION in the rules: R4.3 says the MANAGER is in no team; R4.1 exempts the MANAGER from single-team membership and lib/team-registry.ts says "MANAGER is exempt — can be in any team at will". Which holds?
4. CHANGE MADE (f53b8a1f6): in headless mode an agent MANAGER no longer supplies the governance password to set a chair (mirrors full mode: agents authorize by title, the owner by password). Keep or revert?
5. May a chair unblock, wake or hibernate a MANAGER listed in its team? Traced as reachable by static reading; unchanged.
6. May a chair appoint a team member as ORCHESTRATOR when the slot is empty? Traced as reachable; unchanged.
7. May an ORCHESTRATOR edit a TRDD assigned to its own chief of staff? Pre-existing; unchanged.
8. From A50RC5G8, still open: is a process-level session kill a hard-kill reserved to the user? Which titles may a chair soft-delete (today: member, architect, orchestrator, integrator)?

## Proposed fix

Record each answer verbatim here, then implement it under the card that owns the code.

## Acceptance

- [ ] Each of the 8 questions has a verbatim USER answer recorded
- [ ] Each answer is implemented or filed under the owning card
- [ ] REPORT, not a question: per a read-only script (2026-10-05, soft-deleted rows excluded) 2 of the 3 live teams name a chiefOfStaffId with no live agent; none names an orchestrator. Nothing was modified. Three behaviours are LIVE awaiting ratification: questions 1, 2 and 4
- [ ] CORRECTION to the REPORT box above: the parenthetical 'soft-deleted rows excluded' was false for the chair finding. Re-measured 2026-10-05 with one script that distinguishes the cases: 12 registry rows, 10 live; team 'Test Kanban Team' has no chair and no members; teams 'scen003-test-wizard-team' and 'scen8-noplugin-team' have a chair and ALL members (3 and 2) ABSENT from the registry altogether. Nothing was modified
- [ ] QUESTION 9 (audit trail): an execution that was refused or failed after both managers approved is now stored as status rejected with reason 'Execution refused: …' and no rejector. That mixes machine failures with manager decisions in the governance record. Keep, or add a distinct failed status?

## Approval log

## Approval log
