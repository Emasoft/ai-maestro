---
trdd-id: f4a8fa1c-71ae-4651-9f78-76f051e1afc7
title: Headless-router /api/messages GET+PATCH+DELETE lack auth — same IDOR fixed in the Next.js routes
column: todo
created: 2026-06-19T04:34:45+0200
updated: 2026-06-19T04:34:45+0200
current-owner: amama
assignee: null
priority: 2
severity: HIGH
effort: S
labels: [security, idor, headless, messaging]
task-type: bugfix
parent-trdd: null
relevant-rules: [28, 32, 38]
test-requirements: [unit, integration]
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
release-via: none
external-refs: []
---

# Headless-router /api/messages object-level authz (IDOR) — mirror the Next.js fix

## ⏵ STATE — READ FIRST
The Next.js `/api/messages` routes were fixed this session (commits `e238d4ec` +
`f2d12df3`): `requireAuth` + an ownership override so an authenticated agent may
only read/patch/delete its OWN mailbox (its verified `auth.agentId` overrides the
client-supplied `?agent=` param; the system owner may target any). The
**headless-mode router carries the SAME routes but only POST was hardened** — GET,
PATCH, and DELETE remain unauthenticated. In `MAESTRO_MODE=headless` (the API-only
worker surface) these are LIVE IDORs.

## Evidence (verified 2026-06-19)
`services/headless-router.ts`:
- **GET `/^\/api\/messages$/`** (~line 1479-1493) → `getMessages({ agent: query.agent, ... })` with NO `authenticateAgent`, NO authContext → any caller reads any agent's mailbox by `?agent=`.
- **PATCH** (~1502-1508) → `updateGlobalMessage(query.agent, query.id, query.action)` — no auth → mark-read/archive any agent's messages.
- **DELETE** (~1509-1514) → `removeMessage(query.agent, query.id)` — no auth → delete any agent's messages.
- **POST** (~1494-1500) is already correct: `authenticateAgent(...)` + `buildAuthContext` + `body.from` override. It is the template for the fix.

## Fix (small, mirrors POST + the Next.js routes)
For each of GET/PATCH/DELETE `/api/messages` in `headless-router.ts`:
1. `const auth = authenticateAgent(getHeader(req,'Authorization'), getHeader(req,'X-Agent-Id'), getHeader(req,'Cookie'))`; on `auth.error` → `sendJson(res, auth.status||401, {error})`.
2. Resolve the effective agent param with the same ownership rule as the Next.js
   `resolveAuthorizedAgentParam`: `const agent = auth.agentId || query.agent` (an
   authenticated agent is pinned to its own mailbox; the system owner keeps the
   supplied param). Pass `buildAuthContext(auth)` to the service call where the
   service accepts it (getMessages/updateMessage/removeMessage already take an
   AuthContext in the Next.js path — thread it here too).
NOTE the GET/PATCH/DELETE handlers currently use `_req` (underscored) — un-underscore
to read headers.

## Acceptance
- All four `/api/messages` headless handlers authenticate; an agent token scoped to
  agent A cannot read/patch/delete agent B's messages via `?agent=B` (403/own-scope);
  system-owner session may target any.
- tsc 0; new headless-router auth tests (mirror tests/api + the message-service authz
  tests) green; full suite green.

## Why this exists
Found by the 2026-06-19 recon issue-sweep (`reports/recon-issues/...net-new-authz-disclosure-sweep.md`).
The Next.js routes and this router are two separate handler sets over the SAME
message services; hardening one does not harden the other. Filed (not auto-fixed)
because the fix needs its own tsc+test verification cycle; it is a Tier-0 security
fix (in-scope), so it may be implemented directly when picked up.
