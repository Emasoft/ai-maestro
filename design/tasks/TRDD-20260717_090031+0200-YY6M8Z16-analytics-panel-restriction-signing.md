---
trdd-id: YY6M8Z16
title: Analytics panel-restriction — proxy-side X-Agentlens-Viewer signing (deferred, waits on AgentlensPro npm verifier)
column: backburner
created: 2026-07-17T09:00:31+0200
updated: 2026-07-17T09:00:31+0200
current-owner: ai-maestro
task-type: security
scope: project
parent-trdd:
labels: [analytics, agentlenspro, embed, security]
relevant-rules: [16]
implementation-commits: [5d972107]
external-refs:
  - https://github.com/Emasoft/AgentlensPro/issues/4
  - AgentlensPro TRDD-KDGJ0R38 (basePath — retires our CSP rewrite)
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**USER DECISION (2026-07-17): "B" — DO NOT implement the proxy-side signing now; WAIT for
AgentlensPro to ship the embed-key verifier to npm.** This TRDD is the durable card for that
deferred work. It is on `backburner` because it is gated on an EXTERNAL release, not on any
internal TRDD (so `blocked` — which requires a non-empty `blocked-by:` — does not apply).

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
that AgentlensPro's verifier reads to render (or not) the settings panel. **The proxy does not
stamp that header yet** (verified: 0 signing lines in `analytics-proxy.mjs`). Until it does, a
`role:user` session is write-restricted but the panel is not hidden.

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

**NEXT ACTION (do NOT run until unblocked):** when `npm view agentlenspro version` shows a
release > 2.9.0 whose changelog/#4 confirms the verifier ships, implement the checklist above in
`lib/analytics-proxy.mjs`, add the pinned-vector test, verify (`tsc` + `yarn test` + `yarn build`),
and — if AgentlensPro's `basePath` (their TRDD-KDGJ0R38) also lands — retire our CSP `frame-ancestors`
rewrite and serve same-origin instead.

**UNBLOCK TRIGGER:** AgentlensPro publishes post-2.9.0 to npm with the embed-key verifier. They
said they will post the confirmation on issue #4 / #3. Watch those threads.

**SUPERSEDED — do NOT carry forward:** "implement the signing now" (my A recommendation) — the
USER chose B; it is inert until their npm verifier ships.

## Approval log
- 2026-07-17 — Tier-0 self-mandate (in-project, reversible, our own scope). No approval gate. The
  DEFER decision itself was the USER's ("B").
