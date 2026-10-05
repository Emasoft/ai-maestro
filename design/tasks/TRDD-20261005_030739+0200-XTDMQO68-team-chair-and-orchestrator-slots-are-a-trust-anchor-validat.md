---
trdd-id: XTDMQO68
title: Team chair and orchestrator slots are a trust anchor — validate every writer and make refusals surface
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T04:56:06+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T03:07:39+0200
relevant: [TRDD-A50RC5G8]
implementation-commits: [96245c34c, 5ce4c6a5a, 0f00a70c0, 8f34f9cc2, 1878fd0b6, a762cc46c, b86907f93]
---

# Team chair and orchestrator slots are a trust anchor — validate every writer and make refusals surface

## Problem

Split out of TRDD-A50RC5G8 (2026-10-05), which outgrew one task. `team.chiefOfStaffId` and `team.orchestratorId` now decide every CHIEF-OF-STAFF and ORCHESTRATOR grant in lib/authorization.ts, so who can write them, and with what, is a security boundary of its own.

Landed already (see A50RC5G8): a NEW chair must be a live agent and not the MANAGER in createTeam/updateTeam (96245c34c); cross-host assign-cos repeats both checks inline (5ce4c6a5a).

Open, each to be re-verified by reading before changing:

- Cross-host refusals report success. Per worker read: the request is marked `executed` in lib/governance-request-registry.ts (~208) when the second MANAGER approves, BEFORE execution; a refusal in services/cross-host-governance-service.ts only returns from the lock callback, and the caller answers 200 "Successfully executed" with nothing written. Five refusals in assign-cos alone now have this shape.
- `orchestratorId` has no writer validation equivalent to the chair's (live agent; in the team). The validator's own comment says eligibility lives at the dedicated route.
- The MANAGER-as-chair check is skipped when a caller omits `managerId` (both parameters are optional). Read by the orchestrator: the DeleteTeam G03 undo calls updateTeam with no managerId.
- Chairs seated before the validation are grandfathered silently (the check runs only when the chair changes). Read-only script on 2026-10-05: 2 of 3 live teams name a chair id with no live agent — report to the user, do not modify.
- Rollbacks that re-seat a chair through updateTeam now fail with 404 if the agent is not live at that moment. Read by the orchestrator: DeleteAgent G04 undo restores a teams snapshot with saveTeams and is NOT affected. DeleteTeam G03 undo IS a candidate; whether the agent is restored before it runs was not traced.
- The other four cross-host request types (add-to-team, remove-from-team, remove-cos, transfer-agent) write with saveTeams and skip the single-team and chair-removal rules (per worker table).

## Proposed fix

Make a cross-host refusal surface (a failed status with a reason) instead of returning silently; validate the orchestrator slot at the shared choke point; pass the manager id from every caller or resolve it inside; add a detector for invalid seated chairs rather than re-validating on every update.

## Acceptance

- [x] Cross-host: a refused execution is recorded and returned as failed with its reason; test per refusal
- [ ] orchestratorId: a new value must be a live agent listed in the team; cross-host covered
- [x] No caller of createTeam/updateTeam skips the MANAGER check by omitting managerId
- [x] Detector (lint or heartbeat finding) for a team whose chair or orchestrator is not a live agent
- [ ] DeleteTeam G03 undo traced: can the 404 fire inside a rollback? fixed or proven unreachable
- [ ] The four other cross-host request types obey R4.1 / R4.7
- [ ] Cross-host add-to-team and transfer-agent can place an id that is not a live agent into agentIds (per worker table; saveTeams, no validation). The COS grants and the mint guard read agentIds as membership; today each consumer is saved only by its own downstream getAgent check
- [ ] VERIFIED BY THE ORCHESTRATOR (read at HEAD): lib/governance-request-registry.ts sets request.status = 'executed' inside the approval function when both managers have approved; services/cross-host-governance-service.ts then calls performRequestExecution only if status === 'executed' (two call sites); a comment there already says executed means 'execution was attempted'
- [x] LANDED (see git log for TRDD-XTDMQO68): refused/failed cross-host executions answer 409 with the reason; stored status becomes rejected with 'Execution refused: …'; no broadcast and no 'approved' notification on refusal. 13 tests, one per refusal, go red under the orchestrator's neuter. INTERPRETATION: 'rejected' was reused rather than adding a 'failed' status — overrule by dropping the two markExecutionRefused calls
- [ ] CORRECTION to the 'VERIFIED BY THE ORCHESTRATOR' box above: I saw two call sites, each conditioned on the status being executed — not the absence of other call paths ('only if' over-claimed). The requester-facing answer was then read by the worker (app/api/v1/governance/requests/[id]/approve/route.ts:66-72), not by me
- [ ] Still open after the landing: 'executed' is written BEFORE the run on the success path (needs the registry to return a ready signal instead); the peer host is never told a request was refused; transfer-agent silently skips missing teams (per worker)
- [ ] COMMIT MAP: the cross-host refusal fix is INSIDE commit 0f00a70c0, which is titled as a docs commit (a git lock collision swept the staged code into it). Its intended message is recorded verbatim in the body of commit 896822204. Search for the fix by file, not by subject
- [x] LANDED 8f34f9cc2: markExecutionRefused acts only on an executed request; recording a refusal never throws and never replaces the original reason; transfer-agent refuses a missing destination. JUDGEMENT left in: a missing SOURCE team is not refused (may live on the peer host). Full suites NOT yet run on that tree by the orchestrator (other workers mid-edit) — owed
- [ ] Tell the peer: on an execution refusal the source host's copy stays pending until TTL and is never told. An existing rejection notification may be reusable without a protocol change (to verify)
- [x] The full-suite run owed for 8f34f9cc2 is done: the committed tree including it was green (542 files / 7335 tests, tsc 0 lines) before the next change was restored
- [ ] READ BY THE ORCHESTRATOR: in transfer-agent both refusals precede any mutation and there is one saveTeams at the end, so a refused transfer writes nothing. OPEN: a missing source team is a no-op even on a SAME-host transfer, where a mistyped source id leaves the agent in its real team and adds it to the destination (breaks single-team membership through a path that bypasses validateTeamMutation) — refuse a missing source when the source host is this host. OPEN: if recording a refusal fails, the stored request still reads executed; say so in the 409 body
- [x] LANDED 1878fd0b6: a new orchestrator must be a live agent and not the MANAGER; an omitted managerId is resolved from governance; a same-host transfer from an unknown source team is refused; the 409 says when a refusal could not be recorded. Full suites green on that change alone (545 files / 7450 tests). NOT added: orchestrator-must-be-a-member (create-with-project seats the orchestrator before any member exists, per worker). STILL OPEN: the DeleteTeam undo omits managerId (now covered inside team-registry); detector for grandfathered invalid chairs; executed written before the run; tell the peer on refusal
- [ ] TRIAGE 2026-10-05 (worker-classified, unread by the orchestrator): 6 met, 3 small, 3 large, 2 stale; same report as A50RC5G8. Do not tick from the triage without reading its evidence
- [x] 2026-10-05 EVIDENCE for the managerId box: lib/team-registry.ts resolveSlotBarredId is used by both createTeam and updateTeam (read at HEAD), pinned by tests/team-chair-validation.test.ts 'refuses setting the MANAGER as chair with 409 when the caller OMITS managerId'. The orchestratorId box stays open: a new value must be a live agent IS enforced (assertNewSlotHolderIsLiveAgent, two 404 tests), 'listed in the team' is enforced only at the dedicated route, and no cross-host request type touches orchestratorId.
- [x] 2026-10-05 detector box: b86907f93 (lib/team-slot-liveness.ts wired into the fleet liveness tick, report only, transition-only logging). It will report at first server start on this machine (two stale chair ids), and again on every start.
- [ ] 2026-10-05 a762cc46c sends the source host a rejection when an execution is refused here — but its EFFECT on the peer is NOT PROVEN. Read at HEAD: the peer's rejectGovernanceRequest does nothing if its copy already reads executed; each host keeps its own copy with its own approvals, and I did not trace which status the source copy holds when the target refuses ('pending until TTL' is the card's earlier claim, untraced). No test drives the receiving side with a realistic record. Also open from that commit: refusal reasons disclose local facts to the peer (reason codes would close it); the target is not told when the refusing host is the source; the peer is told refused even when the local record could not be updated; an unknown source host is skipped with no log line; the targetCOS fallback for the wire id has no test.

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
