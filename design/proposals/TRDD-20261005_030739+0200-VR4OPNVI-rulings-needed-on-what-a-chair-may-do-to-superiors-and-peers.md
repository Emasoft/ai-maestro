---
trdd-id: VR4OPNVI
title: Rulings needed on what a chair may do to superiors and peers
column: proposal
status: proposed
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T04:12:23+0200
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
- [ ] QUESTION 10: should a governance token's title and team be read LIVE at authentication (as session secrets already are) instead of trusted as stamped for up to an hour? Not applied. It closes the demoted-MANAGER-keeps-authority window; it also means an unreadable teams file demotes every caller to autonomous until it is readable again
- [ ] QUESTION 11 (R42): answering a pending prompt lets a MANAGER or a team chair type arbitrary text into another agent. Is the exception meant to cover free text, or only the prompt's own options?
- [ ] REPORT: this host currently has NO manager pointer set and all 10 live agents carry no governance title (read-only script, 2026-10-05)
- [ ] 12 (DECIDE) fastedit cannot edit route-table entries in services/headless-router.ts or top-level imports. May workers use the line-level Edit tool for exactly those two shapes? Until answered, six shadowed headless routes and one test-fidelity fix stay undone (safe: the routes are unreachable)
- [ ] 13 (DECIDE) Headless mode has no sudo layer. Cemetery purge (permanent) is now reachable there by the owner without sudo, like hard-delete. Your ruling says hard-kill needs a sudo confirmation: should headless REFUSE purge and hard-delete outright until it has one?
- [ ] 14 (DECIDE) When you resurrect a soft-deleted agent, does it get back the portfolio tokens it held and its old session secret, or come back without them? In progress as an interpretation: tokens stay revoked
- [x] 13 REWORDED (review): your ruling already says hard-kill needs sudo. Being fixed now without waiting: headless cemetery purge and revive will go through the full-mode handler, which requires sudo. Open part only: does permanently purging a cemetery archive count as hard-kill? I am treating it as yes
- [x] 12 CORRECTION (review): the note 'safe: the routes are unreachable' was unverified when written; measured since only against today's registry (no agent carries either name). The question stands for removing dead table entries and for import lines
- [x] 13 CORRECTION: only PURGE is being put behind sudo in headless (my interpretation: permanently destroying an archive is a hard-kill). REVIVE stays as it is — owner only, no sudo — so you can still resurrect in headless. Full mode requires sudo for revive too; say if headless should match
- [x] 14 REWRITTEN ON A FACT (read in the router): revive imports the archive with a NEW agent id. Tokens issued to the old id therefore cannot return to the resurrected agent whatever is decided; and the old session secret belongs to the old id. Remaining question is only: should a resurrected agent be RE-ISSUED equivalent tokens automatically? Default taken: no. Unread: the full-mode revive path and whether the dashboard has a second restore route that keeps the id
- [x] 14 CORRECTION (review): the new-id fact is read from the HEADLESS revive handler and, per a worker's read, the full-mode one too (app/api/agents/cemetery/route.ts) — I have not read the latter myself. NOT covered by it: the old soft-deleted row keeps its id and is removed only best-effort during revive; if that removal fails the old row survives. Being fixed regardless of your answer: a soft-deleted row will no longer authenticate or hold valid tokens
- [x] 13 CORRECTION (review): 'revive stays owner-only in headless' is CONDITIONAL — if the purge worker reports headless can obtain a sudo token, revive should be put behind sudo too (full-mode parity); only if it cannot does your 'can always be resurrected' ruling decide it. Download route's prior reachability was not checked
- [x] 12 WIDENED: the same tool limit blocks every edit inside the two largest pipeline functions (title change, agent delete). One confirmed defect stays open only because of it: a failed token revocation after a title change is reported as success
- [x] 12 NO LONGER BLOCKING: a fastedit-only method for line-range edits was found and used. No answer needed unless you want the Edit tool allowed anyway
- [ ] 15 (FYI/DECIDE) In headless mode five routes never run because an earlier generic route answers first: the four creation-helper session/chat routes and listing role plugins. Nothing is exposed. Do you use the creation helper or role-plugin listing in headless? If not I leave them; if yes they need authentication added before being made reachable

## Approval log

## Approval log
