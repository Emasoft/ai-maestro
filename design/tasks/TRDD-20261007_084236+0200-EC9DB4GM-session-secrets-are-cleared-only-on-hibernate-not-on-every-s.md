---
trdd-id: EC9DB4GM
title: Session secrets are known to be cleared only on hibernate, other stop paths unread
column: todo
status: tasked
created: 2026-10-07T08:42:36+0200
updated: 2026-10-07T09:40:13+0200
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
approval-datetime: 2026-10-07T08:42:36+0200
implementation-commits: [be05c396b]
---

# Session secrets are known to be cleared only on hibernate, other stop paths unread

From the credential spec (CRED-GAP-02, CRED-UNV-06): the mst_ session secret has no expiry in its validator (lib/session-secret.ts:53-63); its hash is cleared on hibernate (services/agents-core-service.ts:2759) and replaced on the next session build (lib/session-env.ts:131-141). Other stop/kill/restart paths were not read. Task: enumerate every path that ends an agent session and make each clear the session-secret hash in the same operation; test that a secret from a stopped session is refused.

## Approval log

- 2026-10-07T08:42:36+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-10-07T09:40:13+0200 — column → todo by main-agent@ai-maestro.

## Notes

- 2026-10-07T09:39:52+0200 — landed in be05c396b. Full suite 617 files / 8174 passed / 2 skipped, eslint 0, HEAD recorded at both ends. Five neuters each redden named cases: no revoke in killSession (3), revoke writes nothing (8), killAgentSessions keeps the hash (2), removeSessionFromAgent keeps the hash (2), revoke hits every agent (4, incl. the no-over-revocation case). The test checks refusal through the real authenticateAgent against a registry under a fake HOME.
- LIMITS, still open: (1) six callers wrap the kill in a catch that ignores errors (wake and session-create launch refusals, creation helper), so a failed revocation there is silent; (2) team freeze logs a failed revocation instead of failing; (3) tests/helpers/drive-delete-agent.ts stubs revokeSessionSecret, so DeleteAgent pipeline tests driven through it cannot see whether the pipeline revokes; (4) no test makes the registry write fail, so 'a failed revocation throws' is unpinned; (5) the secret is one per agent: ending any one of an agent's sessions revokes it; (6) only the tmux runtime revokes; (7) whether a caller holds the agents lock while calling runtime.killSession was checked at the call sites only, not up their call chains; (8) not live until the server is rebuilt and restarted.
