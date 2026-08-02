---
name: network-security-tailscale-bind
description: "why does a LAN IP get dropped / 192.168.x.x cannot reach the dashboard / does Tailscale IPv6 work from an iPad / x-forwarded-for spoof from a phone / how does a route know the real client IP is 127.0.0.1 vs remote / console-only route 403s from Tailscale but works on localhost / dual-bind :: with an IP filter, isAllowedSource"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# network-security-tailscale-bind

AI Maestro's network model is localhost + Tailscale only, dual-bound at the socket level with
a TCP-level IP filter, and gated per-route by identity rather than by network position.

### Dual-bind with IP filter (v0.27.2+)

The server binds to `::` (all interfaces, dual-stack IPv4+IPv6) when Tailscale is detected, but
a TCP-level connection filter (`isAllowedSource()`, in `lib/tailscale-detect.mjs`) drops
connections from non-allowed IPs before any HTTP/WebSocket processing:

| Source | Allowed | Why |
|--------|---------|-----|
| `127.0.0.1`, `::1` | Yes | Localhost |
| `100.64.0.0/10` (Tailscale CGNAT) | Yes | Tailscale VPN IPv4 |
| `fd7a:115c:a1e0:*` (Tailscale ULA) | Yes | Tailscale VPN IPv6 |
| `192.168.x.x` (LAN) | **No** | Dropped at TCP level |
| Any other IP | **No** | Dropped at TCP level |

Without Tailscale installed, the server falls back to `127.0.0.1`-only binding (pure localhost).

**Tailscale is required for any remote access.** The `isAllowedSource()` function in `server.mjs`
is the security gate. When modifying it, only allow Tailscale CGNAT (`100.64.0.0/10`) and
Tailscale ULA (`fd7a:115c:a1e0::/48`) ranges — never allow LAN or public IPs.

### The perimeter is the network; the gate is identity (not network position)

Inside the Tailscale VPN, *every* device is a first-class caller — a phone, an iPad, a remote
machine, a script on a server — because every function must work from a browser when working
remotely. Reachable ≠ permitted: each route still demands its own proof (a session cookie for a
human, an AID proof for an agent, a sudo token for a strict route). Do NOT gate a route on "where
the packet came from" — that breaks remote administration, and it isn't a boundary anyway (see the
trusted-peer note below). Every route is curl-able, so a check placed in a *client* (button, CLI,
hook) is skippable with one curl — it is not a weak check, it is no check. Enforce in the route.

### The trusted client IP — `lib/peer-address.mjs` (TRDD-P7XKV3N9)

A route handler gets a `Request`, never a socket, so it can only learn the caller's address from a
header — and `x-forwarded-for` / `x-real-ip` are **client-forgeable** (a phone sends
`X-Forwarded-For: 127.0.0.1`). So `server.mjs` **deletes any inbound `x-aim-peer` and re-stamps it
from `req.socket.remoteAddress`** (the one place that sees the real TCP peer; we sit behind no
proxy), and `lib/peer-address.mjs` is the only sanctioned reader. `isConsolePeer()` accepts
`::ffff:127.0.0.1` too — the `::` bind is dual-stack. NEVER read `x-forwarded-for` for a security
decision. Verify any spoof test from a genuinely *remote* peer (the host's own Tailscale IP) — from
loopback the peer really is 127.0.0.1 and the test proves nothing.

### Governance-password rotation — `POST /api/governance/password/invalidate` (TRDD-P7XKV3N9)

**What this page owns:** the console gate is the one place where a *network* fact is used as an
authorization input, and it is deliberately narrow. `isConsolePeer()` proves **presence at the
machine** — a second factor beside possession of the password — for a short, argued-for list of
operations. It is NOT the general model: everywhere else, reachable ≠ permitted and the gate is
identity, per the section above.

**Everything else about revocation lives on [[governance-password-invalidation]]** — the two-call
flow, the fail-closed behaviour, the throttle, the calling surfaces, and what is still open. Do not
restate any of it here. That page's own text says the authoritative caller census belongs in
`lib/peer-address.mjs`'s docstring *"because a second copy is what drifted"* — and this section
was, until 2026-08-02, exactly that second copy.[^1]

### Known limitations and behaviour notes

- **Human user authentication via governance password** — first-run setup via
  `POST /api/auth/setup-init` + `/setup-verify`; session cookies (`aim_session`) issued after
  login (see `lib/agent-auth.ts` and `docs_dev/2026-04-02-maestro-auth-design.md`). The old
  "SF-058 bypass" has been CLOSED — no auth headers AND no session cookie → request is rejected.
- **No CORS/CSRF protection yet** — all same-origin by design; reverse-proxy or cross-origin
  deployments need additional middleware.
- **MagicDNS does not work on iOS** — iPad/iPhone must use raw Tailscale IPv4 (e.g.,
  `http://<tailscale-ip>:23000`), not `*.ts.net` hostnames. Run `tailscale ip -4` on the host to
  find the IP.
- **Tailscale IPv6 not routable from same host** — macOS Tailscale app doesn't loopback IPv6;
  works from remote devices but untested on iPad.
- **`tailscale serve` is NOT used** — it breaks Next.js static file serving; direct bind with IP
  filter is used instead.

### Key files

(cited by SYMBOL, not line number — both citations here had rotted to unrelated code after the
filter moved out of `server.mjs`):

- `lib/tailscale-detect.mjs` — **where the filter LIVES**: `isAllowedSource()`,
  `isTailscaleIPv4()`, `detectTailscaleIPv4()`, `diagnoseTailscale()`. Extracted from
  `server.mjs` because that file binds sockets on import, so nothing could import the
  gate and **no test covered it**. Now 16 tests pin it, including both CGNAT edges
  (100.64.0.0 and 100.127.255.255 in; 100.63.255.255 and 100.128.0.0 out).
- `server.mjs` — **where it is WIRED**: imported at the top and applied in the `::`
  bind's TCP connection handler (`if (!isAllowedSource(socket.remoteAddress))`), which
  drops the socket before any HTTP/WebSocket processing.
- `scripts/setup-tailscale.sh` — operator validator; its section 7 asserts BOTH halves
  (defined in the lib, imported by `server.mjs`). Run `--check` for a no-changes audit.
- `lib/agent-auth.ts` — Agent auth bridge (current non-auth bypass for local development; confirm
  against active code before relying on specific line numbers)
- `docs_dev/2026-04-02-maestro-auth-design.md` — Full maestro auth design for Phase 2
- `docs_dev/2026-04-02-remote-host-deep-audit.md` — Deep security audit of all remote access paths

## See also

- [[governance-password-invalidation]] — owns password revocation end to end. This page owns only
  why a console check is a legitimate *presence* factor and not the general authorization model.

## Notes and lessons learned

[^1]: [id:ATOM-NETSEC-DUPCENSUS, status:valid, keywords:"console gate caller list duplicated peer-address census second copy drifted isConsolePeer callers", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT copy the `isConsolePeer` caller census onto a second page, BECAUSE the census's own
    stated rule is that it lives in `lib/peer-address.mjs`'s docstring and that "a second copy is
    what drifted" — the sentence documenting the anti-duplication rule was itself duplicated here
    during the 2026-08-02 CLAUDE.md migration, which is how the rule gets broken: by carrying the
    paragraph that states it. DO link to [[governance-password-invalidation]] and read the census
    at its source.
