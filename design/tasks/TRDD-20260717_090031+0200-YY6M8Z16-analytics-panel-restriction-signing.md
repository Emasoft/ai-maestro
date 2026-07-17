---
trdd-id: YY6M8Z16
title: Analytics panel-restriction — proxy-side X-Agentlens-Viewer signing (deferred, waits on AgentlensPro npm verifier)
column: testing
created: 2026-07-17T09:00:31+0200
updated: 2026-07-17T10:02:38+0200
current-owner: ai-maestro
task-type: security
scope: project
parent-trdd:
labels: [analytics, agentlenspro, embed, security]
relevant-rules: [16]
implementation-commits: [5d972107, f7104bc9, afbb13b9]
external-refs:
  - https://github.com/Emasoft/AgentlensPro/issues/4
  - AgentlensPro TRDD-KDGJ0R38 (basePath — retires our CSP rewrite)
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**FOLLOW-UP FIX (2026-07-17, commit `afbb13b9`) — the panel falsely said "AgentlensPro isn't
running" in the browser even though the upstream was up.** Root cause: `AnalyticsSection.tsx`
health-probes the reverse proxy (main port + 1) with `fetch(..., {credentials:'include'})`
BEFORE framing. That fetch is cross-ORIGIN (the port differs); the proxy sent no
`Access-Control-Allow-Origin`, so the browser DISCARDED even the healthy 200 and the probe's
promise REJECTED → `.catch()` → `probe='down'` → the "isn't running" card. The iframe itself was
never the problem (iframes are CSP/frame-ancestors gated, not CORS gated). Fix: the proxy now
echoes ACAO for the ai-maestro origin ONLY (same derivation as `frameAncestorsFor` — same Host,
pinned main port) with `Allow-Credentials`, on every response INCLUDING the 401/403/503 error
paths (so the probe reads those statuses too). Never `*`; a mismatched origin/host gets nothing —
this widens no trust (the caller is already past the IP filter + session gate). `corsHeadersFor`
is a pure fn (8 unit tests, all green); `deny()` gained an `extraHeaders` arg. VERIFIED live:
matching Origin → ACAO echoed on the 401; wrong port / no Origin → no ACAO. tsc 0, 18/18 analytics
tests, `yarn build` exit 0, pm2 restarted. The panel now mounts the iframe on Reload — NO client
rebuild needed (server-side only). This was the last blocker for the browser round-trip below.

**IMPLEMENTED + VERIFIED (2026-07-17, commit `f7104bc9`), `column: testing`.** The USER first
chose "B" (defer until the verifier shipped to npm); AgentlensPro published **2.10.0 with the
verifier ~40 min later**, so the trigger fired and the signing was built against the live release.

**VERIFIED (everything a machine can prove):** signer reproduces AgentlensPro's §B4 vector
byte-for-byte; 10/10 unit tests (vector + fail-closed key custody); tsc 0; full suite 206/3042;
`yarn build` exit 0; **E2E interop 7/7 against the LIVE 2.10.0 verifier** (my signer + the real
`~/.agentlens/embed-key`, hitting :3000 directly — reproduces AgentlensPro's #4 proof table:
no-header→standalone, role:user→embedded/user, role:maestro→embedded/maestro, garbage→403,
POST /action + GET /api/hook-config as role:user →403, hook-config no-header→200); installer live
run idempotent (already-installed + "server already running").

**REMAINING (human confirmation only):** the full browser round-trip — a logged-in ai-maestro
session on :23000 → the proxy → the panel VISIBLY hidden for a `role:user` — needs the governance
password, which must never pass through the model. The refuse/serve behavior is otherwise proven.

**NO VERSION HARDCODE (USER correction, 2026-07-17):** the install floor stays the stable 2.8.0
janitor baseline; `npm install @>=floor` already tracks the newest release; and the feature is
CAPABILITY-detected at runtime (`readEmbedKey()` present → enforce, absent → fail-closed) — so no
floor bump is ever needed when AgentlensPro releases. An earlier draft bumped the floor to 2.10.0
and was reverted.

**WHAT SHIPPED (commit `5d972107`, task #58):** Settings → Analytics embeds the AgentlensPro
dashboard through ai-maestro's OWN reverse proxy `lib/analytics-proxy.mjs` on `PORT+1` (23001).
The proxy today: Tailscale IP-filter + deep `validateSessionCookie` gate; a **method allowlist**
(non-MAESTRO gets GET/HEAD only → writes 403); strips upstream CSP and re-issues
`frame-ancestors` for the ai-maestro origin; `Cache-Control: no-store`; refuses WS upgrades; 503
with a "start it with: agentlenspro" hint on upstream error. `components/settings/AnalyticsSection.tsx`
frames `?embed=1&tab=analytics` — a locked `?tab=` id in AgentlensPro's contract. The iframe
itself works against **installed npm 2.9.0** (its embed contract = the loopback `frame-ancestors`
CSP + `?embed=1&tab=<id>`).

**THE GAP THIS TRDD CLOSES (the panel-*hide* half):** the USER required that a normal user
"cannot even open" the AgentlensPro settings panel, only MAESTRO. The method allowlist enforces
the WRITE side. The panel-HIDE side needs ai-maestro to send a signed `X-Agentlens-Viewer` header
that AgentlensPro's verifier reads to render (or not) the settings panel. **The proxy now stamps
that header** (`f7104bc9`; `lib/analytics-viewer-token.mjs` signs it, `analytics-proxy.mjs` sets it
per request): a `role:user` session is now BOTH write-restricted AND has the panel hidden.

**WHY DEFERRED (not merely postponed by preference):** AgentlensPro's verifier is on their `main`
@ `553e258` but is **post-2.9.0 — NOT yet in npm**. So even if we stamped the header now, the
installed package has nothing to verify it. Also today `governance.userAuthorityModelEnabled` is
OFF ⇒ every web session IS the maestro ⇒ we would always sign `role:maestro` and the `user` path
is unexercised. Building it now would be inert. B is the correct call.

**THE SPEC IS ALREADY LOCKED — AgentlensPro#4 (their 2026-07-17T05:16 reply) IS the byte-for-byte
contract.** Do NOT re-derive it. Implement exactly:
- **Key:** read `~/.agentlens/embed-key` (32 bytes = 64 lowercase hex, single line, mode MUST be
  `0600` — refuse to use a wider-mode file). It is created by AgentlensPro's server on boot.
- **Header:** `X-Agentlens-Viewer: <b64url(payload)>.<b64url(HMAC-SHA256(b64url(payload), key))>`.
  base64url, NO padding. **HMAC over the ASCII of the b64url payload string** (not the raw JSON).
- **Payload B3:** `{"v":1,"role":<projected>,"iat":<ms>,"exp":iat+60000,"nonce":<16 hex bytes>}`.
- **R37.2 PROJECTION IS ON US (load-bearing):** sign a `maestro-delegate` as `role:"maestro"`.
  Any other string — INCLUDING `maestro-delegate` — makes their verifier 403. Collapse the
  ai-maestro title (`maestro | maestro-delegate | user`) to `maestro | user` before signing;
  use `getActiveMaestroUserId()` / the R37.2 helper to decide who the active maestro is.
- **Inbound hardening:** DELETE any client-supplied `X-Agentlens-Viewer` and re-stamp it
  server-side (same discipline as `lib/peer-address.mjs` for `x-forwarded-for`). Never trust a
  header a client can forge.
- **Fail-closed:** if role resolution throws, sign as `role:"user"` (the more-restrictive side).
- **Pin their test vector byte-for-byte in an ai-maestro unit test** so the two impls cannot
  silently diverge (their B4 vector; key hex `6b6579`, the full header value is in issue #4).
- **Falsifiable wiring check:** hit their `GET /api/embed-status` (`{mode,role,keyLoaded}`)
  through the proxy to PROVE the gate is live, not assumed.

**NEXT ACTION:** none blocking — the signing is implemented + interop-verified. Two follow-ups,
both external: (1) the USER's browser confirmation of the rendered panel-hide (above); (2) when
AgentlensPro's `basePath` ships (their TRDD-KDGJ0R38), retire the proxy's CSP `frame-ancestors`
rewrite and serve same-origin — watch AgentlensPro#4.

**UNBLOCK TRIGGER:** AgentlensPro publishes post-2.9.0 to npm with the embed-key verifier. They
said they will post the confirmation on issue #4 / #3. Watch those threads.

**SUPERSEDED — do NOT carry forward:** "implement the signing now" (my A recommendation) — the
USER chose B; it is inert until their npm verifier ships.

## Approval log
- 2026-07-17 — Tier-0 self-mandate (in-project, reversible, our own scope). No approval gate. The
  DEFER decision itself was the USER's ("B").
