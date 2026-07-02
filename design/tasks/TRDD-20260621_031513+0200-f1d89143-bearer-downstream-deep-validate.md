---
trdd-id: f1d89143-8b8e-470d-90f8-009a9070e43a
title: Deep-validate Bearer credentials at the downstream WS and pty handler — not the pre-handshake gate
column: backburner
created: 2026-06-21T03:15:13+0200
updated: 2026-06-21T03:15:13+0200
current-owner: ai-maestro-session
assignee: null
priority: 3
severity: MEDIUM
task-type: security
release-via: none
parent-trdd: TRDD-ba9d6df2
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [security, auth, websocket, bearer, server-mjs, deferred]
external-refs: ["TRDD-ba9d6df2 §Scope + §Follow-up", "reports/verify-governance-fixes/servermjs-cookie.md"]
---

# TRDD-f1d89143 — Deep-validate Bearer at the downstream WS/pty handler

**Source:** the DERIVED follow-up explicitly carved out of `TRDD-ba9d6df2`
(server.mjs full-mode cookie deep-validation). `ba9d6df2` deep-validated the
`aim_session` COOKIE at the pre-handshake gate but, BY DESIGN, left the **Bearer**
path a presence-only check. This TRDD closes that residual.

## Problem (the residual gap `ba9d6df2` documented, not a regression)

`server.mjs`'s full-mode auth gates — the inline `GET /api/internal/pty-sessions`
handler and the pre-handshake `wsHasCredential` for `/term`, `/status`, `/v1/ws`,
`/companion-ws` — now deep-validate the `aim_session` cookie (commit `66168dc1`,
via `lib/session-validate-server.mjs` reading the shared
`globalThis.__aiMaestroSessionsMap`). But a request bearing an `Authorization:
Bearer <token>` (the `aim_tk_*` AID tokens, `amp_live_sk_*` AMP keys, `mst_*`,
`eyJ…` JWTs) still passes the gate on **presence alone** — the token shape is not
verified against any store. So a **forged Bearer** from a caller already past the
IP filter (`isAllowedSource` admits localhost + every Tailscale peer) clears the
gate and can read pty-session metadata or open a terminal/status/AMP/companion
WebSocket.

**Bounding (why MEDIUM, not HIGH):** the IP filter still admits only
localhost + Tailscale peers (no LAN, no public), so this is a forged-credential
risk for a caller ALREADY on the trusted network surface — not an internet-facing
hole. The cookie path (the browser-session surface) is fully closed; this is the
machine/agent Bearer surface.

## Why `ba9d6df2` deferred it (the load-bearing design constraint)

Deep-validating a Bearer at the **pre-handshake** gate is WRONG because **AID
tokens (`aim_tk_*`) are ONE-SHOT** — consumed on first use via
`active-tokens.json` under a flock. If the gate consumed the token to validate it,
the REAL downstream consumer (the WS connection handler / the pty-sessions logic)
would then find it already-consumed and fail — a self-inflicted bug. The gate
runs BEFORE the handshake; consumption must happen AT the handshake's downstream
consumer, exactly once. Plus `server.mjs` is a `.mjs` with **no unit-test
harness**, so logic added there is unverifiable by the suite.

## Proposed design (move the deep check DOWNSTREAM, into a testable `.ts`)

The fix is NOT to deep-validate at the gate, but at the **post-handshake**
downstream handler where consumption is correct and exactly-once:

1. **Author a `.ts` downstream validator** the unit suite CAN cover (the whole
   reason to move it out of `server.mjs`). It exposes, per credential class:
   - **`aim_tk_*` (AID):** a **one-shot-safe** check. Either (a) a non-consuming
     PEEK that confirms the token exists + is unexpired in `active-tokens.json`
     WITHOUT removing it, leaving consumption to the existing single downstream
     consumer; OR (b) validate-AT-consume — fold the validation INTO the one
     consumption the handler already does, so there is still exactly one consume.
     Pick (a) if a peek API exists; else (b). NEVER add a second consume.
   - **`amp_live_sk_*` (AMP key):** `validateApiKey` against
     `amp-api-keys.json` — file-backed, so a `.mjs`/`.ts` shim can read it
     without the API. (Confirm the canonical validator's location;
     `lib/amp-auth.ts` is the likely home.)
   - **`eyJ…` (JWT):** `jose.jwtVerify` with the server's key. (Confirm whether
     any full-mode WS path actually accepts a raw JWT; if none does, drop this
     class rather than add unused crypto.)
   - **`mst_*`:** identify the validator (governance/sudo?) and wire it, or
     document why it is out of scope for these WS surfaces.
2. **Call sites:** the WS connection handlers for `/term`, `/status`, `/v1/ws`,
   `/companion-ws` (post-handshake) and the `/api/internal/pty-sessions` handler.
   The pre-handshake `wsHasCredential` cookie deep-validation from `ba9d6df2`
   STAYS as-is (a forged COOKIE is still rejected early); only the BEARER deep
   check moves downstream.
3. **`server.mjs` stays a thin caller** — it imports the `.ts` validator (full
   mode shares the Node process via `app.prepare()`, so a `.ts` that the Next
   build compiles is importable from the downstream handlers that live in the
   compiled graph; verify the import path works from the `server.mjs` WS wiring,
   else expose it the same way `lib/session-validate-server.mjs` is exposed).

## Constraints / invariants (DO NOT violate)

- **Exactly-once consumption of one-shot AID tokens.** No double-consume, no
  consume-at-gate. This is the bug `ba9d6df2` deferred to avoid.
- **Fail closed.** A Bearer that fails deep validation → reject the connection
  (same posture as the cookie path).
- **Do not regress the cookie path.** `lib/session-validate-server.mjs` and the
  pre-handshake cookie check are correct — leave them.
- **SSOT.** Reuse the canonical `validateApiKey` / AID / JWT validators; do not
  re-implement token parsing (the `ba9d6df2` NIT was exactly an extractor that
  diverged from its canonical twin).

## Test plan (TDD — the reason for the `.ts` move)

`tests/unit/<bearer-downstream-validate>.test.ts`:
- a live AMP key validates; a forged one is rejected;
- a live AID token validates AND is consumed **exactly once** (assert the
  post-validate store state — consumed if peek-then-consume, or still-present if
  pure peek);
- an expired/forged AID token is rejected and NOT consumed;
- (if JWT in scope) a valid JWT verifies, a tampered one is rejected;
- no-Bearer / malformed-Bearer → rejected.
Plus `tsc --noEmit` clean and the full suite green.

## Acceptance criteria

- A forged Bearer no longer opens any of the 4 WS surfaces or reads pty-sessions.
- A legitimate agent's Bearer still works, and its one-shot AID token is consumed
  exactly once (no "token already used" regression for the real consumer).
- The cookie path is unchanged; unit suite covers the new bearer validator.

## Approval

Authoring this spec is Tier-0 (TRDD intake). IMPLEMENTATION is security-sensitive
(auth surface) — route through the normal review/approval before it lands, and
keep `do-not-push / await-approval` per the campaign mandate. Parked at
`backburner` until the user/MANAGER prioritizes it relative to the 4 tier-2
security proposals (`design/proposals/`).
