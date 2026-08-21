---
trdd-id: 15FF13AE
title: Make AID proof-of-possession nonce-bound instead of timestamp-windowed
column: cancelled
min-approval-requirement: manager
created: 2026-06-16T23:38:54+0200
updated: 2026-08-21T22:36:05+0200
current-owner: null
task-type: security
priority: 3
severity: MEDIUM
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-15ff13ae — Make AID proof-of-possession nonce-bound (challenge/response) instead of timestamp-windowed

**Source:** script↔API security audit, finding L2-M3 (`auth-layer-hardness` AUTH-HARD-01).
**Tier 2 (MANAGER):** core identity protocol.

## Problem (WHY)

The AID token-exchange proof signs `aid-token-exchange\n{client-chosen timestamp}\n{server_url}` and the ONLY anti-replay is a ±300 s drift window (`lib/aid-token.ts:57,194-206`). The token route does NOT record or consume the proof — there is no challenge-issuing endpoint and no consumed-proof cache (verified absent by grep over `lib/aid-token.ts lib/agent-auth.ts app/api/v1/auth/`). Consequence: a passively-captured proof can be POSTed to `POST /api/v1/auth/token` repeatedly for up to 300 s, each call minting a fresh 1 h `aim_tk_*` for that agent.

Bounded today: the server Ed25519-verifies against the agent's REGISTERED key and pins `serverUrl=http://localhost:${PORT}` (refuses `x-forwarded-host`), so cross-agent and off-domain replay both fail; token exchange is rate-limited 30/min per identity + 200/min global. So this is replay-amplification within a 300 s window on a single host, not cross-agent forgery — but it IS a server-side hardness gap, and crucially **code-signing the CLI does not fix it** (the threat is wire-replay of a captured proof, independent of which client sent it).

## Proposed change

Primary (challenge/response):
```
1. Add POST /api/v1/auth/challenge: issues a single-use server nonce (crypto-random,
   short TTL ~30s), stored in an in-memory consumed/issued set.
2. Change the signing input to include that server nonce instead of (or in addition to)
   the client timestamp.
3. In POST /api/v1/auth/token: look up the nonce, verify the proof signs it, DELETE the
   nonce on first successful exchange (consumed-nonce set). Reject unknown/expired/used nonces.
4. Update the client (scripts/aid-maestro-token.sh) to fetch a challenge first, then sign it.
```

Interim (if challenge/response is deferred): a consumed-proof cache keyed by `sha256(proofB64url)` with TTL ≥ the 300 s window, rejecting any proof seen before.

## Acceptance criteria

- The same captured proof POSTed twice → first mints a token, second is rejected (used nonce / seen proof).
- A proof for an expired/unknown nonce → 401.
- The existing Ed25519-against-registered-key and serverUrl-pin checks remain.
- Rate limits still apply.
- Tests: replay-rejected, expired-nonce-rejected, happy-path-single-use, cross-agent-still-rejected (regression).

## Risk / blast radius

Medium-high — this is a protocol change touching both the server token route and the `aid-maestro-token.sh` client. Must ship server + client together (or keep the timestamp path as a fallback during rollout). The interim consumed-proof cache is far lower-risk and could land first.

## Approval log

- 2026-08-21T22:36:05+0200 — CANCELLED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured: fully implemented under a different implementation — `lib/aid-nonce.ts` (single-use, subject-bound, TTL-capped server nonce), `app/api/v1/auth/challenge/route.ts` (issues the nonce), `app/api/v1/auth/token/route.ts` (authenticates the proof, then `consumeNonce()` — authenticate-before-consume, atomic single-use). Tests: `tests/aid-token-nonce-pop.test.ts`, `tests/unit/aid-nonce.test.ts`. All acceptance criteria (replay-rejected, expired/unknown-nonce → 401, Ed25519+serverUrl-pin retained, rate limits intact) are met by the shipped code. Superseded, not declined.
