---
trdd-id: ba9d6df2-781c-43a3-b931-b67144a642f5
title: server.mjs full-mode auth gate must deep-validate the session cookie (not presence-only)
column: complete
created: 2026-06-21T01:39:45+0200
updated: 2026-06-21T02:45:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: security
severity: HIGH
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [security, auth, server-mjs, full-mode, bypass]
---

# TRDD-ba9d6df2 — server.mjs cookie deep-validation (full-mode auth bypass)

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), fix-queue #3.
The user's standing top priority ("always prioritize security"). The full-mode
counterpart of the `a11d1bfb` sessions-browser cookie-auth fix.

## Problem (the bypass)
`server.mjs` gates two surfaces with a credential check:
- `GET /api/internal/pty-sessions` (handled INLINE — no downstream auth) — ~L606.
- WebSocket upgrades for `/term`, `/status`, `/v1/ws`, `/companion-ws`
  (`wsHasCredential`, pre-handshake) — ~L1034.

Both did a **presence-only** cookie check: `/(^|;\s*)aim_session=[…]+/.test(cookie)`.
Any **non-empty** `aim_session` value passed — so a **forged cookie** from a
Tailscale peer or a local process cleared the gate and could read pty-session
metadata or open a terminal/status/AMP/companion WebSocket. The IP filter
(`isAllowedSource`) is the only other gate, and it admits every Tailscale peer +
localhost — so this was a real auth bypass for anyone already past the IP filter.

## Why server.mjs couldn't just call the existing validator
The TS validator `validateSession` lives in `lib/session-auth.ts`. `server.mjs`
runs in full mode via plain `node server.mjs`, so it can only import `.mjs` — it
cannot import the TS function. BUT the session store is an **in-memory Map on
`globalThis.__aiMaestroSessionsMap`** (deliberately global to survive Next HMR +
be process-shared), and `server.mjs` runs in the **same Node process** as the
Next routes (`app.prepare()`), so it **shares that global**. So server.mjs CAN
validate — by reading the shared Map directly.

## Fix
New `lib/session-validate-server.mjs` — a `.mjs` validator server.mjs CAN import:
`validateSessionCookie(cookieHeader)` extracts the `aim_session` token, sha256-hashes
it (mirroring `hashToken`), looks it up in `globalThis.__aiMaestroSessionsMap`, and
returns true iff present AND `Date.now() <= record.expires_at` (evicting expired,
mirroring `validateSession`'s lazy purge). Wired into BOTH server.mjs gates
(`hasSessionCookie` at the pty-sessions route; the cookie branch of
`wsHasCredential`). `lib/session-auth.ts` is UNTOUCHED (no regression risk to the
`a11d1bfb` browser-route path).

**One-source-of-truth:** the DATA (the session Map) is READ, never duplicated. Only
the tiny read contract (cookie name + sha256 + `expires_at`) is replicated across
the unavoidable `.ts`/`.mjs` boundary — documented in both files.

## Scope: COOKIE deep-validated; BEARER stays a presence check — BY DESIGN
The gates also accept a Bearer token (`aim_tk_` AID tokens, `amp_live_sk_` AMP
keys, `mst_`, `eyJ` JWTs). Those are intentionally NOT deep-validated at this
gate: `validateSession` is a PURE READ (safe), but **AID tokens are ONE-SHOT**
(consumed on first use via `active-tokens.json` + a flock) and JWTs need `jose`
crypto. Deep-validating a bearer at this **pre-handshake** gate would **consume a
one-shot token before its real downstream consumer runs** — a bug. So the bearer
stays a non-consuming presence check here; this is exactly why the original design
deferred "deeper token validation downstream."

### Follow-up (DERIVED — separate TRDD, deferred)
Deep bearer validation belongs at the **downstream** WS connection handlers /
pty-sessions handler (post-handshake), where consumption is correct: a
one-shot-safe AID peek (or validate-at-consume), `validateApiKey` for AMP keys
(file-backed, `.mjs`-readable), and `jose.jwtVerify` for JWTs. Until then a forged
*bearer* (not cookie) still passes the gate — a known, documented residual, design-
sensitive (must not consume one-shot tokens at the gate). Note: `server.mjs` is a
`.mjs` file with no unit harness, so this follow-up is best done by moving the deep
check into a `.ts` downstream handler that the unit suite can cover.

## TDD (RED → GREEN)
`tests/unit/session-validate-server.test.ts` (6 cases): RED-verified first (module
absent). GREEN after creating the validator. Covers: cookie extraction, a live
session validates, a **forged token is rejected** (the bypass), an expired session
is rejected + evicted, no-cookie rejected, absent-Map rejected.

## Verification
- `node --check` clean on `server.mjs` + the new `.mjs`.
- `tsc --noEmit` clean (pre-existing `6133` unused-var hints in server.mjs are not
  errors and not from this change).
- **Full unit suite: 107 files, 1864 passed / 0 failed** (+1 file, +6 tests), 2
  pre-existing skips. Zero regressions.
- No legit-user lockout: a real `aim_session` still validates; a stale cookie after
  `pm2 restart` correctly 401s → re-login (the designed "sessions cleared on
  restart" posture, consistent with the `a11d1bfb` HTTP routes).

## Implementation (2026-06-21)
`lib/session-validate-server.mjs` (new) + `server.mjs` (import + 2 gate sites +
comment updates) + `tests/unit/session-validate-server.test.ts` (new) +
`docs/API-CHANGES.md` §11. Landed in the overnight campaign (TRDD-903b7a20). Not
pushed.

## Verification + NIT fix (2026-06-21)
The campaign's adversarial-verification workflow returned **CONFIRMED** on this
fix: cookie deep-validated, 0 bypasses, the bearer-presence-by-design scope sound,
the sha256+expires_at read mirrors `validateSession`, no legit lockout, the `.mjs`
cannot throw on a malformed cookie / absent Map. One **NIT**: the `.mjs`
extractor's regex `(?:^|;\s*)aim_session=` rejected a cookie with leading
whitespace before the FIRST pair (e.g. `"  aim_session=…"`), while the canonical
`extractSessionFromCookie` in `lib/session-auth.ts` (split + `.trim()` each pair)
ACCEPTS it — a false-negative-only divergence (rejects a valid token, never
accepts an invalid one; both still require the sha256 in the shared Map), and
unreachable in practice (RFC 6265 `Cookie:` headers have no leading whitespace
before the first pair). Fixed for byte-for-byte parity (the `.mjs`'s whole purpose
is to mirror the canonical extractor): regex anchor `(?:^|;\s*)` → `(?:^|;)\s*` so
`\s*` absorbs leading whitespace after BOTH `^` and `;`. Added 2 parity test cases
(leading space + tab). Still fails closed. tsc 0 errors (the IDE-diagnostic
"cannot find .mjs module" is a false positive — the project tsconfig resolves it,
`npx tsc --noEmit` is clean); session-validate test file 6/6 (now 8 assertions).
