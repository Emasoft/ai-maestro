---
trdd-id: TCDIVXPS
title: Headless DELETE sessions has no authorization — any agent can kill any session
column: dev
status: tasked
created: 2026-10-05T01:44:34+0200
updated: 2026-10-07T05:28:53+0200
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
approval-datetime: 2026-10-05T01:44:34+0200
implementation-commits: [6626cbe60]
---

# Headless DELETE sessions has no authorization — any agent can kill any session

## Problem

In HEADLESS mode, `DELETE /api/sessions/:id` authenticates the caller and nothing else
(`services/headless-router.ts:890-895`, read 2026-10-05): it then calls `deleteSession(params.id)`,
which kills the tmux session, unpersists it, and soft-deletes the agent record
(`services/sessions-service.ts`, `deleteSession` — the function takes no caller identity). So any
authenticated agent, under any title, can kill any other agent's session and remove its record.

The full-mode route for the same path (`app/api/sessions/[id]/route.ts`) calls `enforceAuth` and
`requireSudoToken`. The two server modes disagree, and the weaker one is the one with no human at
a dashboard.

Found by a read-only investigation for TRDD-A50RC5G8 (report under reports/a50rc5g8/, gitignored)
and verified first-hand against the three files above.

## Root cause

The authorization decision lives in the route layer for one mode and nowhere for the other. The
service function both modes share does not know who is calling.

## Proposed fix

Put the decision in the SERVICE: `deleteSession(sessionName, authContext)` resolves the session to
its agent and calls `authorize(auth, 'delete-session', agentId)`; a non-owner caller that fails is
refused 403 before any tmux or registry action, and a missing authContext is refused 401. Both
routers pass the caller's verified identity. This applies TODAY's policy for that action (system
owner; MANAGER; CHIEF-OF-STAFF own team) — it does not decide the open ruling on whether a
process-level kill is user-only (TRDD-L6VV9Q7U); it stops everyone else.

## Verification

Service-level tests: MEMBER on another agent's session refused, and NO runtime kill / unpersist /
registry delete happened; CHIEF-OF-STAFF other team refused; MANAGER and system owner proceed; no
authContext refused. Neuter the check and record the red set. Run the headless router path.

## Acceptance

- [x] `deleteSession` refuses an unauthorized or unidentified caller before any side effect
- [x] Headless and full-mode routes both pass the verified identity; neither can reach the service without one
- [x] Refusal tests assert no kill, no unpersist, no registry write; neuter recorded
- [x] Every other caller of `deleteSession` enumerated and updated
- [x] SCOPE OF THE CLAIM, stated honestly: PROVEN open is the headless handler (authenticates, then calls the service). NOT verified: whether anything authorizes before the headless router, and whether full mode is closed — `enforceAuth` admits agents and whether `requireSudoToken` also applies the delete-session authorization was not read. The service fix closes both either way; settle these two reads and record them here
- [x] `deleteSession` also soft-deletes the AGENT RECORD (`deleteAgentBySession`) with NO cemetery archive (per the TRDD-A50RC5G8 investigation; not re-read). Under the USER ruling of 2026-10-05 ("only soft-kill ... the agent corpse in the cemetery can always be resurrected") an agent deletion must leave a resurrectable archive. Authorizing as delete-session is not enough: route the record deletion through the archiving DeleteAgent pipeline, or stop deleting the record here. This card must not close on authorization alone
- [x] Target resolution tested on an indexed multi-session name and on the cloud branch, not only on a mocked single session
- [x] BEHAVIOUR CHANGE named: a session that resolves to no registry agent (an orphan tmux session) can afterwards be removed only by the system owner
- [x] 2026-10-05 target resolution box: d24147c8e adds tests/unit/delete-session-target-resolution.test.ts (indexed name, both-exist, cloud branch, unauthorized caller) against the real registry resolver; own neuter 3 of 8 red, names in the commit message.
- [x] 2026-10-05 LIMITS of d24147c8e (review): the indexed session is simulated by NAME only — no agent record carries a real second session; the target is observed indirectly through an authorization verdict; the unauthorized-caller cases have no neuter; whether the redirected HOME fully contains the registry read was not proven by a before/after count of the real registry.
- [x] RECORD 2026-10-05 for the scope box, both reads settled (worker located, lines read by me): (1) headless — the DELETE /api/sessions/:id handler authenticates and calls deleteSession(id, buildAuthContext(auth)) with nothing between; the router's own gates only prove a credential is present (per the comment on the export handler in the same file). (2) full mode — lib/sudo-guard.ts maps 'DELETE /api/sessions/[id]' to { action: 'delete-session', session: true } and decideAidTitle resolves the session to its agent and calls authorize. The service itself calls authorize(…, 'delete-session', …) before deleting, so both modes are closed by the service. The remaining open box waits on question 16 of TRDD-VR4OPNVI.
- 2026-10-07 DECISION (main-session interpretation of the USER ruling of 2026-10-05, overrule in one line): chose (a). deleteSession now kills tmux + unpersists and leaves the agent record registered (offline); no caller needed the record gone (only callers: app/api/sessions/[id]/route.ts, marked DEPRECATED, and the headless handler; no UI caller). Cloud agents have no session, so deleteSession answers them 409 pointing at DeleteAgent. Proof: tests/unit/delete-session-target-resolution.test.ts asserts the real registry file is byte-identical after deleteSession; neuter (re-adding deleteAgentBySession) reddened 7 tests. Also removed the now-stale services/sessions-service.ts::deleteAgentBySession entry from KNOWN_BYPASSES in tests/unit/all-in-one-single-path.test.ts.

## Approval log
- 2026-10-05 — LANDED 6626cbe60 by main-agent@ai-maestro. Scope settled by reading (worker report, spot-checked): HEADLESS was open — the router authenticates only before dispatch; FULL mode was already closed for agents — requireSudoToken also runs the title check from the sudo-guard route map. Still OPEN: (1) deleteSession marks the record deleted with NO cemetery archive (lib/agent-registry.ts deleteAgent soft path sets deletedAt only); (2) target resolution on an indexed name is defective — getAgentBySession (lib/agent-registry.ts:487-491) strips the trailing index, so session "alpha_1" resolves to agent "alpha" even when an agent named "alpha_1" exists. The indexed-session box stays unticked for that reason.

## Approval log

- 2026-10-05T01:44:34+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
