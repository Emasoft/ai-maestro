---
trdd-id: QR9FSL3Q
title: Cross-host groups — broadcast chat rooms spanning hosts; teams stay same-host (R45)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-08-16T16:48:46+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [45, 43, 12]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R45** (committed `bf70bf47`, v4.4.0).
Held under the transition-phase hold — do NOT implement.

**NEXT ACTION when unheld:** extend `types/group.ts` `subscriberIds` to accept cross-host
`agentId@hostId` addresses (the same multi-host addressing tmux/AMP already use) and route
`POST /api/groups/{id}/notify` to remote subscribers via the cross-host peer directory
(`lib/agent-directory.ts`). Do NOT touch team code except to enforce R45.1.

## Problem

R45.2 allows a **group** (broadcast chat room — no titles, no COS, no kanban) to include agents from
different hosts, while a **team** (R45.1, the R12 5-role base) must stay same-host. Today groups
(`lib/group-registry.ts`, `types/group.ts`, `services/groups-service.ts`) are host-local:
`subscriberIds` are local agent ids and `notify` delivers only locally.

## Approach (design sketch)

1. **Cross-host subscribers.** `Group.subscriberIds` carries `agentId@hostId` addresses. Local ids
   stay valid (host defaults to self). Validation resolves each against the local registry or the
   peer directory (`lib/agent-directory.ts` — cross-host peer agents).
2. **Cross-host broadcast.** `POST /api/groups/{id}/notify` fans out: local subscribers via the
   existing local path; remote subscribers via AMP federation / the peer rail. An offline peer
   queues (AMP relay `/api/v1/messages/pending`), never blocks.
3. **Teams stay same-host (R45.1).** Team creation + add-member reject an agent on another host with
   a clear message ("migrate it here first — R44"). Enforce in `lib/team-registry.ts` /
   the team membership pipeline.
4. **No governance change.** A group is not a governance unit — no titles/COS/kanban touched.

## Verification
- A group with agents on 2 hosts; a broadcast reaches subscribers on both.
- An offline peer's subscriber receives the message on reconnect (relay).
- Team add rejects a cross-host agent.
- §0 mirror-sync: GOVERNANCE R45 (built).

## Estimated risk
MED. Depends on reliable cross-host AMP routing + the peer directory. The team-same-host guard is
cheap; the cross-host fan-out reuses AMP federation (already exists) so risk is mostly delivery
reliability, not new protocol.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-W9FA6ACZ (ASSISTANT R39) · TRDD-HR8CES7H (usernames
R47) · TRDD-40CUZA1Z (sidebar R46) · TRDD-PLOVIPZE (console gates R48) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Acceptance
- [ ] `types/group.ts` `subscriberIds` accepts `agentId@hostId` cross-host addresses; a bare
      local id still resolves (host defaults to self).
- [ ] `POST /api/groups/{id}/notify` fans out to local subscribers via the existing local path
      and to remote subscribers via the cross-host peer directory (`lib/agent-directory.ts`).
- [ ] A group with agents on 2 hosts: a broadcast reaches subscribers on both hosts.
- [ ] An offline peer's subscriber receives the message on reconnect (AMP relay
      `/api/v1/messages/pending`) rather than the broadcast blocking.
- [ ] Team creation / add-member REJECTS a cross-host agent with a clear message pointing at
      R44 migration (`lib/team-registry.ts`) — teams stay same-host (R45.1).
- [ ] §0 mirror-sync done: GOVERNANCE-RULES R45 marked built.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: manager;
  user authority >= manager). Verbatim: *"author all those TRDDs, but wait to implement them."*
  Implementation HELD.

## Notes and lessons learned
