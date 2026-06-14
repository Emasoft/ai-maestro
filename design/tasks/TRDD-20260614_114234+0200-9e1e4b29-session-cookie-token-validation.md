---
trdd-id: 9e1e4b29-4fd5-44d1-b021-ceef38ddf557
title: Validate the aim_session cookie token on sessions-browser routes — hasSessionCookie is presence-only
status: not-started
created: 2026-06-14T11:42:34+0200
updated: 2026-06-14T11:42:34+0200
---

# TRDD-9e1e4b29 — Validate the aim_session cookie on sessions-browser routes

**Source:** pre-merge security review of TRDD-1657a5f4 (chat-history redesign), finding **MINOR-2**. Report: `reports/chat-history-review/security-20260614_110626+0200.md`.

## Problem
Every `/api/sessions-browser/*` route (range, search, context-breakdown, lifeline, timelines) gates access on `hasSessionCookie`, which returns `true` for ANY non-empty `aim_session` cookie value. It does NOT validate the token against the server session store. A client on the allowed network (localhost / Tailscale, enforced by `server.mjs:isAllowedSource()`) that sends `Cookie: aim_session=anything` passes the gate and can read every agent's full conversation transcript and context breakdown.

The chat-history redesign did NOT introduce this — `hasSessionCookie` is pre-existing and project-wide — but the feature now exposes far more data (complete transcripts, token economics, context snapshots) behind that weak gate, raising its severity.

## Root cause
`services/sessions-browser-service.ts` `hasSessionCookie()` (≈ lines 150-163) is presence-only. Its own comment admits it: "For now the mere presence of the cookie value is what the spec defines… swap this helper for a richer check." The real validator already exists: `validateSession()` in `lib/session-auth.ts`.

## Proposed change
1. Replace the presence-only check with token validation: extract the `aim_session` value and call `validateSession()`. Treat invalid/expired/absent → 401 `unauthenticated`.
2. If `validateSession()` is async, make the route gate async (the route handlers are already async).
3. Apply to ALL sessions-browser routes currently using `hasSessionCookie` — one shared gate, not per-route copies.

## Derived tasks / risks
- **Login round-trip:** confirm the human-login flow (`POST /api/auth/setup-verify` → `aim_session` cookie, `lib/agent-auth.ts`) issues a token `validateSession()` accepts; otherwise the legitimate logged-in user gets locked out. Add a non-mocked test (login → cookie → route 200; bogus cookie → 401).
- **Caller audit:** grep every caller of `hasSessionCookie` so none keep the weak check.
- **Coordinate** with TRDD-5df6f7da (extract the shared route guard) — both centralize per-route guards in the same files; land together to avoid two refactors.
- **Approval:** security/auth change touching every sessions-browser route → likely MANAGER/USER approval before execution (per approval-tiers).

## Acceptance
- Forged/absent `aim_session` → 401 on every sessions-browser route; reader never invoked.
- Valid session cookie → 200 (existing behavior preserved).
- Real round-trip test added (not mocked), mirroring the path-traversal test pattern in `tests/unit/route-isolation.test.ts`.
- `yarn test` + `tsc --noEmit` green.
