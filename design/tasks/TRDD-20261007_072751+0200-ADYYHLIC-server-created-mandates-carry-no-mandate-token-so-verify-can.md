---
trdd-id: ADYYHLIC
title: Server-created mandates carry no mandate-token so verify cannot confirm them
column: todo
status: tasked
created: 2026-10-07T07:27:51+0200
updated: 2026-10-07T10:43:06+0200
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
approval-datetime: 2026-10-07T07:27:51+0200
implementation-commits: [75c548695, 1c23cb8bb, 5a9c0605b]
---

# Server-created mandates carry no mandate-token so verify cannot confirm them

lib/trdd-create.ts writes mandate: true / approved: true / approval-judge for a mandate (around line 353) but no create path calls mintTrddDecisionToken; only app/api/trdd/[id]/approve/route.ts does. verifyTrddDecision (lib/trdd-approval-token.ts) returns verified:false for any card whose min-approval-requirement is above none and has no approval-token/mandate-token, so every legitimate server-issued mandate reports UNVERIFIED. The approval overlay was qualified in the same session to say so (rules/aimaestro/aimaestro-trdd-approval.md). Fix: mint a mandate token inside the create critical section once authority is established, write it as mandate-token:, and degrade honestly (no token, still created) when the audit ledger is unavailable, mirroring approve. Then drop the qualification from the overlay.

## Approval log

- 2026-10-07T07:27:51+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-07T10:43:06+0200 — column → todo by main-agent@ai-maestro.

## Notes

- 2026-10-07T08:53:51+0200 — owner delegated ("decide yourself on the others"); main-agent@ai-maestro chose option 3: mint the mandate token so verify can prove a mandate, then drop the interim stop-and-confirm wording in rules/aimaestro/aimaestro-trdd-approval.md, which deadlocks team agents (confirmation must route through the chief-of-staff).
- 2026-10-07T10:42:54+0200 — landed: 75c548695 (the create route mints mandate-token for a mandate above none; tokens sign the issuer's real title, orchestrator included), 1c23cb8bb (the title is read from the registry, the source the verifier checks; the create response says when no token could be minted), 5a9c0605b (an unreadable registry leaves the decision unverifiable instead of throwing). GATE, stated in full: 75c548695 was red on its own commit (two 30 s test timeouts in files that passed alone); 1c23cb8bb passed the full suite (620 files, 8196 passed); 5a9c0605b was red once (a wall-clock assertion in server-liveness off by 17 ms) and green on one rerun (620 files, 8197 passed). Load average was 20 to 69 on 14 cores throughout; the reds are attributed to load and were not reproduced.
- OPEN: (1) the rules wording in rules/aimaestro is deliberately UNCHANGED until the server is rebuilt and restarted and a mandate created through the running server is shown to pass verify; the running build mints no token, so relaxed wording would send every agent back to the issuer in a loop. (2) Mandates already on disk and cards made with the trddgrep CLI have no token; re-issue is create-again-and-supersede. (3) The create route decides mandate status from the title on the request while the mint signs the registry title, so the two can disagree. (4) approve and promote return nothing to the caller when the mint yields no token. (5) app/api/agents/[id]/portfolio/route.ts keeps its own older title mapping. (6) The create route was not driven end to end. (7) The same mint serves approval and verdict tokens: an agent whose registry title has no rung on the approval ladder gets none.
