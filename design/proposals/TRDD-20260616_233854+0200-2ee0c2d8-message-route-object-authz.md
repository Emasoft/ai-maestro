---
trdd-id: 2ee0c2d8-fba0-4da0-8a47-ee849b1f0fd1
title: Enforce per-mailbox object-level authz on every message route
status: proposal
column: proposal
approval-tier: 2
created: 2026-06-16T23:38:54+0200
updated: 2026-06-16T23:38:54+0200
current-owner: null
task-type: security
priority: 0
severity: CRITICAL
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-2ee0c2d8 — Enforce per-mailbox object-level authz on every message route

**Source:** script↔API security audit, findings L2-C1, L2-M1, L2-H3.
**Tier 2 (MANAGER):** touches the server auth surface / governance.

## Problem (WHY)

The message routes verify caller IDENTITY but not per-mailbox OWNERSHIP — a textbook IDOR family. Three concrete gaps, all reachable by a raw `curl` carrying any agent's own valid `AID_AUTH` (the script layer is irrelevant):

1. **`GET /api/messages?agent=<victim>` (CRITICAL).** Handler authenticates, then passes `searchParams.get('agent')` straight into `getMessages` with no compare to `auth.agentId`. Any authenticated agent reads the victim's unread inbox, **full message bodies**, sent folder, counts, stats.
   - route `app/api/messages/route.ts:8-35`; svc `services/messages-service.ts:118,127,179`; store `lib/messageQueue.ts:670-701`.
2. **`PATCH`/`DELETE /api/messages?agent=<victim>` (MEDIUM).** Same root cause on the write side — mark-read / archive / **delete** another agent's messages. `updateMessage`/`removeMessage` take no `authContext`.
   - route `app/api/messages/route.ts:84-120`; svc `services/messages-service.ts:248-280,286-306`.
3. **`GET /api/agents/[id]/messages` (HIGH) — UNAUTHENTICATED.** The GET handler IMPORTS `enforceAuth, requireAuth` (`:4`) but CALLS NEITHER — straight to `listMessages(id, …)`. `listMessages` does only a `getAgent` existence check, no `authContext`, no ownership check. Any client (a raw `curl` even WITHOUT a token) reads another agent's bodies/subjects/stats. The POST sibling IS correctly enforced (`requireAuth` `:52`, mismatch reject at svc `:276-281`).
   - route `app/api/agents/[id]/messages/route.ts:10-38`; svc `services/agents-messaging-service.ts:220-263`.

The correct pattern already exists in the codebase: `POST /api/messages` forwards `authContext` and overrides `body.from = auth.agentId`; `sendMessage` rejects `authContext.agentId !== agentId`.

## Proposed change

```
1. app/api/agents/[id]/messages/route.ts (GET): add
     const auth = requireAuth(request); if (!auth.ok) return auth.error
   forward auth.context into listMessages(id, opts, auth.context).
2. services/agents-messaging-service.ts::listMessages: add an authContext param;
   reject when the path id !== authContext.agentId unless authContext.isSystemOwner
   (mirror sendMessage's reject at :276-281).
3. app/api/messages/route.ts (GET + PATCH + DELETE): resolve the `agent` query param
   to a UUID (resolveAgentIdentifier) and require it == auth.agentId
   (system-owner / !auth.agentId exempt), 403 otherwise.
4. services/messages-service.ts: thread authContext into getMessages / updateMessage /
   removeMessage and enforce the owner check there too (defence-in-depth, so a future
   caller can't skip it at the route).
```

## Acceptance criteria

- A raw `curl` to `GET /api/agents/<other-uuid>/messages` with NO token → 401.
- A raw `curl` to `GET|PATCH|DELETE /api/messages?agent=<other-uuid>` with agent A's valid `AID_AUTH` → 403.
- An agent reading/mutating its OWN mailbox (any of the three routes) still succeeds.
- System-owner (valid `aim_session` cookie, `!auth.agentId`) retains cross-mailbox access.
- New unit tests cover: self-OK, cross-agent-403, no-token-401, system-owner-OK for all three route families.

## Risk / blast radius

Low-risk fix (additive guards). Watch for callers that legitimately read another agent's mailbox as system-owner (the web UI) — those go through a cookie, so `isSystemOwner` is true and the guard passes.

## Realignment + status (2026-06-18, GOVERNANCE-RULES v4.0.1)

Governed by **R28** (AID → title authz), **R38** (user/agent messaging restrictions), **R32** (agents never use sudo — the fix is AID-auth + ownership, NOT a sudo gate). **PARTIALLY IMPLEMENTED** in commit `e238d4ec`:
- ✅ Gap 3 (HIGH, unauthenticated `GET /api/agents/[id]/messages`) — now `requireAuth` + own-mailbox-only (`auth.agentId === id`); system owner unaffected.
- ✅ Gap 1 (CRITICAL, `GET /api/messages?agent=`) — the route now overrides the `agent` param with the verified `auth.agentId` for agent callers (mirrors the POST `body.from` override); system owner may still query any.
- ⏳ **Remaining (follow-up):** Gap 2 (MEDIUM) — `PATCH`/`DELETE /api/messages?agent=` still lack the same ownership compare; and the **service-layer defence-in-depth** (proposed steps 2 & 4 — `listMessages`/`getMessages`/`updateMessage`/`removeMessage` enforcing the owner check) is not yet wired. The route-level guards close the read-IDOR; the write side + defence-in-depth remain.

tsc clean; 1527 unit tests pass.

## Approval log
