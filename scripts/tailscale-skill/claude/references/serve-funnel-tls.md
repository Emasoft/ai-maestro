# Tailscale Serve, Funnel, and TLS/certs — merged reference

> Covers `tailscale serve`, Funnel, and TLS certificates, together with the DNS/MagicDNS,
> troubleshooting, and Docker/container behaviour specific to them.
>
> `[unverified]` marks a single-source or low-confidence claim. Version-gated behaviour
> names the version explicitly.
>
> **Section 0 records four facts established by DIRECT MEASUREMENT** against a real
> `tailscale 1.98.5` binary. Where they sharpen or disagree with a widely-repeated claim,
> section 0 is authoritative; the superseded framing is kept alongside it for context,
> never silently deleted.

## 0. Directly-measured corrections — read this first

1. **`tailscale serve` reverse-proxies FROM LOOPBACK.** A remote tailnet peer's request arrives at
   the local backend as a connection from `::ffff:127.0.0.1` — the IPv4-mapped-IPv6 loopback
   form — never the peer's real Tailscale IP. Any backend auth/authorization logic keyed on
   "is the caller local?" (checking the peer socket address) is therefore **silently bypassed for
   the whole tailnet** — every tailnet peer looks exactly as local as a request from `localhost`
   itself would. The `Tailscale-User-Login`/`-Name`/`-Profile-Pic` identity headers (§2c) are
   trustworthy **only**, and only for as long as, `tailscale serve`'s proxy is the SOLE path to
   that backend — this measurement is the concrete mechanism behind the trust rule in §2c,
   not a contradiction of it; it is the missing "why."
2. **`tailscale serve reset` is NODE-WIDE** ("Reset current serve config"), not port- or
   path-scoped — confirmed by direct CLI inspection. `<path> off` removes one path.
   **`tailscale serve clear` IS a real command** — it belongs to the Services/TailVIP family
   (`tailscale serve clear <service-name>` — "Remove all config for a service"), corroborated
   independently by the troubleshooting table below. Do **not** write that
   `clear` "does not exist" — it exists and is scoped to Services. This is DISTINCT from the
   disputed single-PATH `clear <path>` verb a single source used (see §5d) — that
   narrower form remains unattested outside that one source.
3. **`serve status --json` was genuinely broken in Tailscale CLI 1.98.1**
   (`flag provided but not defined: -json`) and **WORKS in 1.98.5** (returns `{}`, exit 0, on a
   node with no serve config). Treat this strictly as version-gated, per the best available
   framing — never as "broken," full stop.
4. **The widely-repeated claim that Serve/Funnel "breaks Next.js static file serving" was TESTED
   and NOT reproduced.** A production Next.js 14.2.35 app served both HTML (200) and a
   `/_next/static/…/*.css` asset (200, `text/css`, 4173 bytes) through `tailscale serve`,
   byte-identical to a direct (non-Serve) control fetch. No source ever named a
   concrete Next.js failure mode — several explicitly flag this as an open gap, not a confirmed
   break. Treat "Serve breaks Next.js" as
   **unreproduced**, not confirmed — a single-app test does not establish universality for every
   Next.js configuration.

Also flagged `[unverified]` rather than measured either way: whether
`tailscale serve --https=<fqdn> <target>` is a deprecated flag form in favor of
`--bg "http://<fqdn> http://service:port"` — one source states this with no version pinned;
not independently checked.

---

## 1. The three exposure choices, and when each is wrong

| | `tailscale serve` | `tailscale funnel` | direct-bind (no Serve/Funnel) |
|---|---|---|---|
| Audience | Tailnet members only | Public internet, no Tailscale needed | Whatever the bind address + network path allow |
| Ports | Any port | **443, 8443, 10000 ONLY** (hard Tailscale limit, not app-level; confirmed at the implementation level via `serve.IsFunnelPort`) | Any |
| Auth | Tailscale identity (ACLs respected) | **NONE** — Tailscale auth is bypassed entirely | None (network reachability only) |
| Transport | TLS auto-terminated at the node (MagicDNS cert); WireGuard-encrypted to peer regardless | HTTPS-only on the public edge; traffic **routed through Tailscale's relay servers**, never peer-to-peer, but still end-to-end encrypted (relay cannot decrypt) | Plain HTTP/TCP over the tailnet, or over whatever interface it's bound to |
| Setup | Simple; HTTPS-enabled-in-tailnet prompt | Requires MagicDNS + HTTPS certs + explicit `funnel` nodeAttr grant in tailnet ACL policy + (historically) admin-console Funnel toggle | None — just bind and report the URL |
| Rate/DDoS/SLA | Tailscale-side: none published | **NO auth, NO rate limiting, NO DDoS protection, NO SLA** by Tailscale — app must implement its own | N/A |
| Production suitability | Yes, for internal tools | Vendor's own framing: dev/test/low-traffic internal tools, **"not designed for production"** | Depends entirely on what fronts it |
| Under Headscale (self-hosted control plane) | Works fine | **NOT SUPPORTED AT ALL** — Funnel requires Tailscale's SaaS control plane; only Tailscale-hosted tailnets can Funnel (flagged as a hard capability gap other units don't mention) | Works fine |

**Compact Serve-vs-Funnel table variant** (repeated near-verbatim by ≥6 sources — kept because a
reader may only see this shorter form): Access (tailnet only / public internet) · Auth (Tailscale
identity / none) · Ports (any / 443,8443,10000 only) · URL shape identical
(`https://<node>.<tailnet>.ts.net[:port]`, publicly resolvable for Funnel) · Setup (simple /
requires admin-console+policy activation). And the terse per-question form:
Who needs access? / Tailscale client required? / Available ports? / TLS automatic? (yes, both) /
Traffic encrypted in transit? (yes, both) / Tailscale rate-limits? (no, both) / Requires
nodeAttrs? (no / yes) / Production-suitable? (yes for internal / dev-testing preferred).

### When each is the wrong tool (stated across sources, not one canonical rule)

- **Funnel is wrong** whenever the audience must be tailnet-only (no public exposure needed) —
  default to Serve, and multiple independent sources explicitly instruct: *never enable Funnel
  unless the user EXPLICITLY asks, and even then ask what auth/protection they want first*
  (verbatim: *"funnel publishes a local service to the entire internet — only use
  deliberately"*; *"Funnel BYPASSES Tailscale auth so add your own authentication"*; *"Use
  `tailscale serve`, never `tailscale funnel`. Funnel is public."*).
- **Serve is wrong** when public (non-tailnet) access is a genuine requirement.
- **Neither works** for two services wanting the **same port** simultaneously — Serve and Funnel
  cannot both own the same node+DNS-name+port combination as private and public at once
  (the error message is "Funnel already active on this port").
  **They CAN coexist on DIFFERENT ports on the same node/app**: `tailscale serve
  https://localhost:8000` (internal, any port) plus `tailscale funnel 8443` (public, must be one
  of 443/8443/10000) run simultaneously for the same underlying service.
- **Direct-bind is the right call** when a plain HTTP dev-loop URL is enough and the extra
  HTTPS/MagicDNS layer buys nothing (one example, `dev-preview`, binds straight to the tailnet IP
  and reports `http://<ts-ip>:<port>`, with no cert/MagicDNS-name overhead; another has `pnpm dev`
  bound to localhost + `tailscale serve --bg` as the RECOMMENDED default, with `--host 0.0.0.0` +
  raw tailnet-IP access as the explicit fallback, flagged because `0.0.0.0` "may expose the
  service to OTHER connected networks — check host firewall and application trust assumptions").
  Choose Serve for a stable HTTPS/MagicDNS URL + multi-path routing; choose
  direct-bind-to-tailscale-IP for a bare HTTP loop.
- **What NOT to expose, even via Funnel or ANY tunnel:** admin panels (router/hypervisor/NAS),
  password managers, LAN-only IoT/printer tools, private document/data portals — *"a tunnel makes
  services accessible, not secure"* (quoting a broader non-Tailscale-specific source). For
  these, stay on Serve (tailnet-only) or plain WireGuard.

### A binding nuance that looks contradictory but isn't

One source states the local backend "must bind `0.0.0.0` or `localhost`, not a narrow
interface" — while another states only `http://127.0.0.1` targets are supported as the Serve
**proxy target argument**, never `0.0.0.0`. These describe two different things: the first is
about what interface the BACKEND process itself should listen on (broadly — `0.0.0.0` covers
`127.0.0.1` too, so this is "don't restrict yourself to one specific NIC's address"); the second
is about what address string you pass AS THE TARGET to the `tailscale serve` command itself
(always `127.0.0.1`, regardless of what the backend's own bind address is). Bind the backend
broadly if you like; always point `tailscale serve` at `127.0.0.1:<port>` specifically.

### Node Sharing — a related but DISTINCT feature from Serve/Funnel

Admin console (Machines > Share) or app-initiated; recipient accepts an invite link; the shared
device appears in the recipient's device list flagged as external-tailnet; recipient reaches it
via MagicDNS name or Tailscale IP. This is **whole-device** sharing governed by the OWNER
tailnet's ACLs (not the recipient's) — the recipient cannot re-share, and can reach any port the
owner's ACLs allow, not just one service. Revoke anytime (Machines > Shared). Do not confuse this
with Serve (a private HTTP(S) proxy to one local port) or Funnel (public exposure of one Serve
config) — Node Sharing operates at the device level, Serve/Funnel at the service level.

### tsnet (embedding, not the CLI)

`Server.ListenTLS(":443")` → private HTTPS (auto Let's Encrypt cert via Tailscale's HTTPS
feature; tailnet must have HTTPS enabled in the admin console). `Server.ListenFunnel(":443")`
exposes the SAME listener publicly via Funnel. `tsnet.FunnelOnly()` splits private vs public
logic onto separate listeners on the same port pattern.

### Tailscale Services — GA and use cases (see §5e for the full CLI/config detail)

GA as of early 2026, available on all plans. Named use cases include
high-availability internal apps, ephemeral workloads (containers/serverless), identity-
aware proxies, and MCP servers — dynamic environments where consumers must locate
services by a stable name rather than a device IP.

---

## 2. What a backend sees behind `tailscale serve` — THE LOAD-BEARING QUESTION

### 2a. The TLS hop: Tailscale terminates TLS; the backend gets plain HTTP

Tailscale (the daemon on the serving node) terminates TLS itself. **The local backend only ever
sees plain HTTP, never HTTPS, regardless of how the client connected** (browser HTTPS, `curl`,
raw Tailscale IP) — this holds even when the client used the public Funnel URL. The
Tailscale→local-target hop is intentionally UNENCRYPTED HTTP/TCP unless you deliberately proxy to
an HTTPS target, because the WireGuard tunnel between peers is already end-to-end encrypted —
double-encrypting the last mile buys nothing. A self-signed/invalid
local HTTPS backend can still be proxied via `https+insecure://localhost:PORT` — a narrow escape
hatch for exactly that case, not a general TLS-bypass flag.

**Only `http://127.0.0.1` targets are supported as a Serve proxy target — NOT `0.0.0.0`, not LAN
IPs.** Binding the app to `0.0.0.0` instead is possible but loses the guarantee that only
Serve mediates access, and requires a separate firewall layer (e.g. UFW) to block direct
public-interface reachability — Serve-as-sole-ingress is the preferred pattern.

**Directly measured (§0.1): the connection Serve hands to the backend originates from
`::ffff:127.0.0.1`, the IPv4-mapped loopback address** — not the requesting peer's real Tailscale
IP, and identically so whether the requester is the same machine, a tailnet peer, or (via Funnel)
a public internet visitor. Any authorization check that inspects the connecting socket's address
to decide "is this local/trusted?" will treat every one of those callers as equally local. This is
the underlying mechanism that makes the §2c trust rule necessary rather than merely advisory.

### 2b. Client-IP forwarding — non-default, and thin coverage

By default the backend sees the connection as originating from Tailscale's **local proxy**, not
the real remote client — it cannot tell which tailnet peer is calling (this is exactly the
loopback-socket behaviour measured in §0.1). **`--proxy-protocol=1|2`** (v1.92+) is the flag that
forwards the original client IP through Serve via the PROXY protocol (confidence: MED — single
terse mention, no worked example). For **Funnel's TCP handlers specifically**,
Tailscale prepends PROXY protocol v1 headers so the backend can recover the real client IP — e.g.
`tailscale funnel --tcp=443 tcp://localhost:8080`, and the backend must parse
`PROXY TCP4 <ip> ...` itself.

**No `X-Forwarded-For` header is documented anywhere for Serve/Funnel HTTP
proxying.** Multiple independent sources explicitly flag this as an absence, not a refutation:
one notes "None of the units address whether the backend sees the real tailnet client IP vs a
proxy-local address... confidence: none — absent, not contradicted", another notes "No
source... documents client-IP preservation, X-Forwarded-For... flagging it as confidence:
LOW/absent", another notes "nothing discussed X-Forwarded-For / Tailscale-User-*
headers under Serve", and another notes "no mention of X-Forwarded-For, Tailscale-User-*
headers, or client IP passthrough". Given the §0.1 loopback
measurement, this absence now reads as expected rather than merely unlucky: since Serve hands the
backend a loopback-sourced connection unconditionally, a raw socket-level header carrying the real
IP was never structurally necessary for the identity-header mechanism (§2c) to work — but it IS
still necessary for anything that wants the real client IP for logging/rate-limiting, and the
ONLY forwarding mechanism actually documented for that purpose is `--proxy-protocol`
(above), not a header.

### 2c. Identity headers — `Tailscale-User-*` — and the trust rule (READ THIS BEFORE TRUSTING ANY HEADER)

When a request passes through `tailscale serve`'s identity-aware proxy, Tailscale injects:

```
Tailscale-User-Login
Tailscale-User-Name
Tailscale-User-Profile-Pic
```

identifying the connecting tailnet identity — usable for app-level auth with **zero extra setup**
(a concrete example: an app's `/api/mercury/*` routes check
`Tailscale-User-Login` and reject with 403 `not_on_tailnet` if absent, using this as its sole
attribution mechanism). This still **respects the tailnet's ACL rules** — Serve does not bypass
policy the way Funnel does. There is also a distinct, capability-scoped mechanism:
**`--accept-app-caps=com.example.app/read,com.example.app/write`** forwards Tailscale identity
information *and* per-app-capability grants to the local service for apps that need the
connecting peer's authenticated identity plus specific capabilities.

**THE TRUST RULE, STATED PRECISELY — this is the single most important fact in
this file:**

> These identity/capability headers (`Tailscale-User-Login` etc., and anything forwarded via
> `--accept-app-caps`) are trustworthy **ONLY** because `tailscale serve`'s local proxy path is
> the **SOLE** path to the backend. **Do NOT expose the same upstream directly on any other
> interface** (a raw port, `0.0.0.0`, a LAN address, a container port-mapping) — if the backend is
> reachable by any route other than Serve's proxy, a client on that other route can **forge the
> same header names themselves**, and the backend has no way to tell a forged header from a
> Serve-injected one.
>
> Concretely: these headers are populated **only** for traffic that actually passed through
> Serve's proxy. A request that reaches the raw backend port bypasses them entirely — so the
> backend must be deployed such that **only Serve's proxied path is reachable** (this
> gotcha), or it must not rely on the header at all when direct reachability exists.

This is precisely the `X-Forwarded-For`/`Tailscale-User-*` trust-boundary equivalent
(the analogy is explicit): identity headers are trustworthy exactly because — and only
because — Serve is the exclusive ingress; remove that exclusivity and the trust boundary
disappears. **§0.1's loopback measurement is the mechanical explanation of WHY** — the socket
Serve hands the backend is indistinguishable from any other loopback connection, so the only
thing separating a legitimate tailnet request from a forged one is the header, and the only thing
protecting the header from being forged is exclusivity of path.

### 2d. Two documented architectures that DON'T rely on the identity header at all

- **`secret-intake`:** binds to `0.0.0.0` but relies on the surrounding network/tailnet
  (not the bind address, and not any forwarded header) to guarantee tailnet-only reachability —
  security model is "reachable only via the tailnet" + TLS termination at Serve + zero logging +
  `Cache-Control: no-store`. It says **nothing** about `X-Forwarded-For` or `Tailscale-User-*`
  reaching the backend. Full architecture and worked example: §7c.
- **`tailscale-networking-3`:** states the opposite/stricter posture as a
  hard rule — *"every listening port must bind to the Tailscale IP or 127.0.0.1 — never
  `0.0.0.0`"* — specifically to avoid accidental LAN/public exposure. **This directly disagrees
  with `secret-intake`'s `0.0.0.0` choice.** Nothing here reconciles the two;
  `secret-intake`'s approach is riskier if the host has ANY other network path (misconfigured
  firewall, second NIC, container port-mapping) that a strict-Tailscale-IP bind would have
  prevented by construction. **Prefer the stricter bind-to-tailscale-IP-or-127.0.0.1 rule** when
  designing a new service — it is defense-in-depth against exactly the failure mode that makes
  the identity-header trust rule (2c) fragile.

### 2e. Multiple Host headers reach the backend, depending on path taken

Requests reach the backend with **different `Host` headers** depending on which route the client
took: `localhost:PORT` (same-machine, no Tailscale involved), `hostname.tailnet-name.ts.net` (via
Serve), or `100.x.y.z:PORT` (raw Tailscale IP direct to a `0.0.0.0`-bound service). CORS
allowlists and any host-header allowlist must enumerate **all three**, not just the Serve
hostname. Same-machine `localhost:PORT` access and the
Serve-proxied `https://hostname.ts.net` URL work **simultaneously** and without conflict — Serve
does not interfere with localhost access.

---

## 3. Reported incompatibilities — precisely scoped

**Do not over-generalize these.** It is explicit that generic "Serve/Funnel breaks
reverse-proxying" claims are NOT supported — several sources found **no** reported
websocket/SPA/static-asset incompatibility at all and flagged that absence as a gap, not evidence
of safety. The incompatibilities that ARE documented are narrow and specific:

### 3a. SPA / subpath asset-URL breakage — REAL, reported by 3+ independent sources

- **Streamlit behind a Serve subpath** renders a **blank page** because static asset URLs are
  requested relative to `/` instead of the actual mount path. Fix: pass
  `--server.baseUrlPath=/<subpath>` to `streamlit run` (reported by two independent sources;
  `uv run streamlit run app.py --server.address 0.0.0.0 --server.baseUrlPath=/stock` then
  `sudo tailscale serve --bg --set-path /stock http://localhost:8501/stock`).
- **SearXNG must be proxied at root (`/`), never a subpath** (`/searxng` → 404). Proxy target
  must be `http://localhost:8081/`, not `.../searxng`.
- **Generic SPA routing under a path-mounted Serve/Funnel:** mounting an app at `/svc-xxxx` via
  `--set-path` breaks single-page-app router assumptions (the app's own router assumes it owns
  the domain root). The `/expose` skill's documented workaround is to **bypass the
  HTTPS Serve path entirely for SPAs** and hand the user the raw
  `http://<tailscale-ip>:<port>` direct-access URL instead (confidence: HIGH for the
  workaround being real/recommended, MED for the exact mechanism — not independently verified
  against Tailscale's own docs; full automation detail in §7h). "Mounting at a subpath may
  require the app framework to be configured with a matching base path (SPA/base-href issue)" is
  repeated generically across sources.

### 3b. What is NOT a confirmed incompatibility (explicit absences — do not treat as "no problem exists")

- **WebSocket/reverse-proxy behavior is repeatedly framed as a UNIVERSAL reverse-proxy concern,
  not Tailscale-specific.** No source reports Tailscale Serve/Funnel itself
  mishandling WebSockets. The non-Tailscale reverse-proxy material (Caddy vs Nginx
  `Upgrade`/`Connection` header handling) is the only websocket-adjacent material present, and it
  is about generic reverse proxies, not Serve/Funnel.
- **No Next.js-specific breakage was ever confirmed anywhere, and it was actively
  tested and NOT reproduced** — see §0.4 for the measurement. Multiple sources
  flag the absence of any Next.js-specific report as a genuine gap; the §0.4 measurement
  (production Next.js 14.2.35, HTML + `/_next/static/*.css` both 200 through Serve,
  byte-identical to a direct control) is a data point AGAINST the folklore, not exhaustive proof
  for every Next.js configuration (static export, custom `basePath`, middleware-heavy routing,
  etc. were not tested).
- **No other-framework-specific breakage** (beyond Streamlit/SearXNG/generic-SPA in §3a) was
  reported in any source consulted — treat that as a genuine gap to verify elsewhere,
  not a "confirmed no problems" finding.
- Static-asset caching and long-lived WebSocket keepalive through Serve/Funnel are NOT documented
  beyond the SPA/subpath cases above.

### 3c. Dev-server Host-header rejection — expected, and how to diagnose it correctly

**Not a Tailscale bug.** Vite and similar dev servers validate the `Host` header and reject
anything not explicitly allowlisted — even when the TCP connection and Serve config are both
perfectly correct. **Diagnose it directly, before assuming a Tailscale-layer
problem:**

```bash
curl -I -H 'Host: MACHINE.TAILNET.ts.net' http://127.0.0.1:PORT/
```

Fix by adding the printed Serve hostname to the dev server's allowed-hosts config
(framework-specific env var, e.g. `EXPLORER_ALLOWED_HOSTS=MACHINE.TAILNET.ts.net` for one
reported example). If the app then loads over Serve but HMR/WebSocket misbehaves on a
mobile client, the documented fix is to **abandon dev-mode HMR over the tailnet
entirely** and repoint Serve at a production build/preview port instead — not to keep debugging
HMR-over-Serve.

A related environment-specific gotcha: **WSL/localhost ambiguity** — if Tailscale runs on Windows
but the dev server runs inside WSL, `http://127.0.0.1:PORT` as the Serve target means WINDOWS
localhost, not WSL localhost (the two network namespaces don't share loopback). Test candidate
targets (`127.0.0.1`, `localhost`, the WSL-assigned IP, e.g. `10.255.255.254`) from the SAME shell
where `tailscale serve` runs, and use whichever responds. For Next.js in WSL, bind with
`next dev -H 0.0.0.0 -p 3000`.

**A DIFFERENT failure that looks similar but has a different fix — missing SNI, not a Host-header
rejection:** `curl` from the SAME machine that is serving can fail the TLS handshake outright
with `no SNI ServerName`, rather than getting a Host-header rejection from the app. Fix by
supplying SNI explicitly:

```bash
curl --resolve "hostname:443:100.x.x.x" https://<fqdn>/subpath
```

This is distinct from the "self-curl can hang" hairpin issue in §5e (a TLS handshake
failure vs. a connection that never completes) — diagnose which one you actually have before
picking a fix.

### 3d. Non-HTTP protocols — Tailscale has a purpose-built escape hatch

Forcing non-HTTP protocols (SSH, raw databases) through an HTTP-aware tunnel/proxy layer "can
introduce unexpected behavior" (a generic, non-Tailscale-specific caution).
Tailscale's OWN raw-TCP Serve modes (`--tcp=<port>`, `--tls-terminated-tcp=<port>`) exist
precisely to give non-HTTP protocols a clean raw-TCP path instead of forcing them through HTTP
semantics — e.g. exposing Postgres on 5432 with Tailscale doing the TLS termination.

### 3e. Certificate provisioning gate (see also §4)

Both Serve's and Funnel's automatic HTTPS certs require **MagicDNS AND HTTPS-in-admin-console**
to be enabled first. If either is off, cert provisioning silently never happens and the service
either stays HTTP-only or fails the funnel prerequisite check outright.

### 3f. Docker/container-specific cert failure — real, with a documented fix

`tailscale cert <fqdn>` **FAILS inside Docker**:

```
500 Internal Server Error: acme.GetReg: dial tcp: lookup acme-v02... on [fd7a:115c:a1e0::53]:53: server misbehaving
```

Cause: Tailscale's MagicDNS overwrites `/etc/resolv.conf` inside the container to point ONLY at
`100.100.100.100`, making the external ACME-server DNS lookup unresolvable (reported by two
independent sources).

**Fix:** use `tailscale serve --bg` instead of `tailscale cert` — Serve's HTTPS/ACME machinery
works internally without needing external DNS resolution for cert generation:

```bash
tailscale serve --bg "http://${FQDN} http://backend:8080"
```

Alternative fix: add external nameservers (`8.8.8.8`, `8.8.4.4`) to `/etc/resolv.conf`
**BEFORE** `tailscaled` starts in the container entrypoint. Note: the
`tailscale serve --https=<fqdn> ...` flag form is reported **DEPRECATED**; use the
`--bg "http://<fqdn> http://service:port"` form instead
`[unverified — version not pinned by the source; see §0]`.

### 3g. Self-hosted control plane (Headscale) constraints

- **Funnel is not supported at all under Headscale** — only Tailscale's SaaS control plane
  implements Funnel. `serve` (tailnet-private HTTPS) works fine under Headscale.
  Any "expose to the internet" requirement on a Headscale tailnet
  needs a different mechanism entirely (reverse proxy on a real public IP, a separate ingress).
- **Custom/self-hosted control server can reject `--https` Serve requests outright**:
  self-hosted Headscale "can't provision Tailscale's HTTPS certs and REJECTS `--https` serve
  requests" — use `--http` instead when authenticated against a custom control server.
- **Live custom-control-server detection must NOT rely on the persisted UI setting** — a node can
  be authenticated against a self-hosted Headscale via CLI login/restored state while an app's
  persisted "control server" setting stays empty/stale. Correct pattern: read `Prefs.ControlURL`
  from `/localapi/v0/prefs` live and compare against the well-known Tailscale default
  `https://controlplane.tailscale.com`; use THAT boolean to decide `--https` vs `--http` for serve,
  and whether to hide Funnel in the UI — not the persisted config flag. If the live prefs lookup
  fails (daemon still starting), fail safe to the persisted flag rather than erroring
  (this is "the 'why does serve pick the wrong scheme' root cause").

---

## 4. TLS/certificate mechanics

### 4a. Auto-provisioning and prerequisites

Both `serve` and `funnel` rely on Tailscale's automatic HTTPS certificate provisioning, which
requires, in the admin console:

1. **MagicDNS enabled** (DNS page).
2. **"HTTPS Certificates" enabled** (DNS page) — WITHOUT this, the serve config can be *stored*
   but the HTTPS endpoint fails the TLS handshake with
   `500 Internal Server Error: your Tailscale account does not support getting TLS certs`.
3. Enabling HTTPS certs **PUBLISHES the machine+tailnet DNS name via the public Certificate
   Transparency log** — an explicit, stated privacy caveat.
4. ACLs must permit the client device/user to reach the serving machine.

Certs auto-renew (they expire after 90 days; the daemon auto-renews). A `serve`/`funnel`
failure with no other symptom is frequently just "HTTPS certs not enabled" or "tailscale logged
out" — check the admin console DNS → HTTPS Certificates page first. One source gives an
explicit failure string for exactly this: `--publish` failure message
`"funnel failed — enable Funnel node attribute in the tailnet ACLs + HTTPS certs"`, and general
serve-failure guidance of "tailscale logged out, HTTPS certs not enabled".

**Before enabling Funnel, treat it as public exposure and review, not a flip of a switch** — one
source states this as an explicit, repeatable checklist: review hostname/port/target, app-layer
auth, secrets appearing in responses, and logs, BEFORE enabling Funnel. A minimal
example Funnel-eligibility policy fragment: `{"nodeAttrs":[{"target":["tag:funnel"],"attr":["funnel"]}]}`
— the fuller grant syntax with `autogroup:member` as the default target is
`{"nodeAttrs": [{"target": ["tag:servers"], "attr": ["funnel"]}]}`.
Limiting Funnel eligibility to explicit users/groups/tags (rather than a broad org-wide default)
is the recommended production posture. "Audit regularly with `tailscale funnel
status` and remove stale endpoints".

### 4b. `tailscale cert` — standalone cert issuance

```bash
tailscale cert [--cert-file=<path>] [--key-file=<path>] [--serve-demo] <machine-or-service-name>.<tailnet-name>.ts.net
```

- Requires MagicDNS + HTTPS/cert settings enabled, and the node must be allowed to request
  certs.
- **Domain MUST be the EXACT tailnet FQDN** as reported in `DNSNames` (`tailscale status
  --json`) — using `.local` or any other suffix returns a **500 error**.
- Certs land at `/var/lib/tailscale/certs/<hostname>.<domain>.{crt,key}` (Linux daemon
  storage) — reading them typically needs `sudo`.
- Writing a cert also publishes the hostname via Certificate Transparency logs (the same
  privacy note as §4a.3).
- Distinct from Funnel's public-facing exposure — a tailnet-private HTTPS cert via
  `tailscale cert` is NOT the same thing as a publicly-exposed Funnel endpoint.
- **`--serve-demo`** serves a demo page on 443 using the freshly-issued cert — a
  quick way to confirm the cert actually works without wiring it into your own app first.
- **Changing the device hostname** (`tailscale set --hostname=`) can silently change the ENTIRE
  tailnet domain suffix, invalidating any cert/serve config that referenced the old domain —
  always re-check `DNSNames` after a rename, and run `tailscale serve reset` before re-adding
  routes on the new domain. Getting the hostname/DNSNames programmatically:
  ```bash
  tailscale status --json 2>&1 | python3 -c "
  import sys, json
  d = json.load(sys.stdin)
  s = d.get('Self', {})
  print('HostName:', s.get('HostName'))
  print('DNSNames:', s.get('DNSNames', []))
  "
  ```
- For apps that read certs only at startup, force-renew + reload via cron:
  ```
  0 3 * * * tailscale cert --cert-file=/etc/ssl/ts.crt --key-file=/etc/ssl/ts.key && systemctl reload nginx
  ```

### 4c. Zero-ACME integration (Caddy)

Caddy can fetch/renew certs via the Tailscale daemon socket directly, with **no ACME config at
all**:

```
myhost.tailnet-name.ts.net {
    tls { get_certificate tailscale }
    reverse_proxy localhost:3000
}
```

### 4d. Self-signed / non-Tailscale-issued certs

A tailnet **without** Tailscale-issued certs presents a self-signed cert to clients, requiring
explicit `--insecure`/trust-bypass on the client side (e.g.
`CHROME_DEVTOOLS_MCP_REMOTE_INSECURE=1`) — this is the distinguishing symptom vs a properly
cert-issued endpoint (confidence MED for the self-signed-vs-issued inference). Similarly,
first-access browser cert warnings on a freshly-Served HTTPS endpoint are normal/expected — use
`curl -k` to bypass for internal-only services; don't mistake this for a real TLS problem
(confidence MED).

**Worked example of consuming a self-signed/Tailscale-issued endpoint remotely:** a
chrome-devtools remote-debugging daemon + Chrome running on a REMOTE host, reachable at e.g.
`https://macbook13-pro.tail3ce7a.ts.net/mcp`:
```bash
export CHROME_DEVTOOLS_MCP_REMOTE_URL="https://macbook13-pro.tail3ce7a.ts.net/mcp"
chrome-devtools status --remote="$CHROME_DEVTOOLS_MCP_REMOTE_URL"
```
healthy = `status=ok http=200`. Self-signed cert (common on tailnets without Tailscale-issued
certs): pass `--insecure` on every call, or `export CHROME_DEVTOOLS_MCP_REMOTE_INSECURE=1`.
Bearer-token gateway: `--header "Authorization: Bearer $TOKEN"` (repeatable, NOT cached, must be
supplied on every invocation). `status` returning `Failed to reach remote` → run
`tailscale status` locally; the box is offline or the URL has the wrong hostname.

### 4e. DERP relay certs (self-hosted DERP, adjacent but distinct from Serve/Funnel)

`tailscale/derper` supports: automatic Let's Encrypt issuance (listens on port 80 for the ACME
HTTP-01 challenge), manual certs via `--cert=/path/cert.pem --key=/path/key.pem`, or TLS
termination at an external reverse proxy (nginx/Caddy/Traefik) forwarding to the local DERP port.
This is a separate cert-provisioning surface from Serve/Funnel's own HTTPS.

### 4f. K8s / Talos SAN requirement

For `talosctl` to connect via a Tailscale IP, the machine cert must include the Tailscale CGNAT
range and the MagicDNS name in `certSANs`:

```yaml
machine:
  certSANs:
    - 100.64.0.0/10
    - talos-cp-1.tailnet-id.ts.net
```

### 4g. MagicDNS mechanics (the prerequisite underlying every cert above)

Full hostname format: `<machine>.<tailnet-name>.ts.net`; short hostname works within-tailnet when
unambiguous. Enable/disable per device without affecting others:
`sudo tailscale set --accept-dns=false`. Global nameservers apply tailnet-wide (e.g. route all DNS
through Pi-hole). **Split DNS**: route specific domains to a designated resolver (e.g.
`corp.example.com` → `10.0.0.53`), everything else to the global nameserver. DNS-over-HTTPS is
supported for global nameservers (`https://dns.cloudflare.com/dns-query`,
`https://dns.google/dns-query`).

**Resolution order**: (1) `*.ts.net`/tailnet hostnames → MagicDNS; (2) split-DNS-matched domains
→ their restricted resolver; (3) everything else → global nameserver; (4) if no global nameserver
set → falls through to the OS resolver.

Check current config via CLI: `tailscale dns status` (shows current nameservers, search domains,
MagicDNS status, split-DNS rules), `tailscale dns query google.com` (v1.74.0+). Full
tailnet-wide config lives in the admin console at `https://login.tailscale.com/admin/dns`.
To find just the tailnet name programmatically: `tailscale status --json | grep -i
tailnet`, or check the admin console's Machines page (`https://login.tailscale.com/admin/machines`).

**DNS troubleshooting** — devices can't resolve each other: enable "Use Tailscale DNS settings"
on the client, verify MagicDNS is enabled tailnet-wide, restart the Tailscale client. Internal
(split-DNS) domain not resolving: verify the restricted nameserver config, confirm the domain
pattern matches the subdomains you expect, confirm the internal DNS server is reachable over the
tailnet, and test with `nslookup hostname.corp.example.com`.

### 4h. Clock drift as a TLS-validation canary (general technique, not Tailscale-specific)

**This technique is generic — it applies to any TLS-terminating service, Tailscale-issued certs
included, not something Tailscale documents itself.** Kept here because a clock-drift failure
mode presents identically to a broken cert and is easy to misdiagnose as one. Fetch the `Date:`
header from a plain HTTPS HEAD request and diff it against the local clock:

```bash
curl -sIA 'net-ops-probe' --max-time 5 https://www.google.com
```

A drift of more than ±300 seconds is flagged as "will break TLS cert validation." Cross-reference
with the OS's own time-sync state: macOS `systemsetup -getusingnetworktime` /
`-getnetworktimeserver`, optionally `sntp -t 3 <server>` for the offset; Linux
`timedatectl show` (look at `NTPSynchronized=`), or `chronyc tracking` (stratum 16 means
unsynced), or check for a running `ntpd`. This works without querying any NTP infrastructure
directly and catches the "stratum-16 unsynced clock silently breaks all TLS" failure mode, which
is otherwise invisible until a cert-validation error surfaces downstream — including, potentially,
against a Tailscale-issued cert.

---

## 5. Flags — exact syntax, and version-gated behaviour

### 5a. `tailscale serve` — full flag/target surface

```bash
tailscale serve [flags] <target>
tailscale serve <port>                              # shorthand, e.g. `tailscale serve 3000`
tailscale serve https://localhost:3000               # Tailscale re-encrypts to this HTTPS backend
tailscale serve http://localhost:8080
tailscale serve https+insecure://localhost:8443      # self-signed/invalid local HTTPS backend
tailscale serve /path/to/dir                         # static directory
tailscale serve /path/to/file                        # static file
tailscale serve text:"OK"                            # literal text (health checks)
tailscale serve tcp:5432 tcp://localhost:5432        # raw TCP forward
tailscale serve tls-terminated-tcp:5432 tcp://localhost:5432
tailscale serve status [--json]
tailscale serve --https=443 off                      # remove one handler at that port
tailscale serve --set-path=/api off                  # remove one path-mounted handler
tailscale serve reset                                # remove ALL serve config (node-wide — §0.2)
tailscale serve get-config [<file>] / set-config [<file>]   # export/import serve config
tailscale serve --service=svc:<name> --bg <target>   # attach to a Tailscale Service (see §5e)
tailscale serve drain svc:<name>                      # HA: stop new conns, finish existing
tailscale serve advertise svc:<name>                  # HA: bring a drained service back
tailscale serve clear svc:<name>                      # remove ALL config for a Service (§0.2, §5e/§6c)
```

**Flags:** `--https=<port>` (default 443; only 443/8443/10000 for Funnel-eligible ports, but ANY
port for tailnet-only Serve), `--http=<port>` (plain HTTP, no TLS), `--set-path=<path>` (mount at
a URL path — the mechanism for multiple independent mounts on one node/port), `--bg` (persist
across reboots/terminal exit — see §5c; also the **default mode for Tailscale Services**),
`--tcp=<port>`, `--tls-terminated-tcp=<port>`,
`--proxy-protocol=<1|2>` (v1.92+, forward original client IP — §2b),
`--accept-app-caps=<caps>` (forward identity/capability headers — §2c),
`--service=<svc>` (Tailscale Services — §5e), `--operator=<account>` (see §5l), `--yes`.

**A community `/expose` automation built on these primitives** — auto-detects a running dev
server (scans common ports 3000/3001/4200/5173/... via `lsof -i :$port`, PLUS a process-name grep
across `next`/`vite`/`webpack`/`parcel`/`snowpack`/`turbopack` via `lsof -i -P`), generates a
unique path (`/svc-<8-hex>` via `openssl rand -hex 4`, or `/<service-name>`), runs
`tailscale serve --set-path <path> --bg http://localhost:<port>`, tracks the mapping in a local
JSON registry (path, port, url, direct-access URL), and checks for path collisions BEFORE
mounting via:
```bash
tailscale serve status --json | jq '.Web["<domain>:443"].Handlers["<path>"].Proxy'
```
For SPAs specifically it recommends bypassing the path-mounted HTTPS route entirely and handing
the user the raw `http://<tailscale-ip>:<port>` direct-access URL instead (§3a).

### 5b. `tailscale funnel` — same target grammar, public exposure

```bash
tailscale funnel <port>                              # shorthand
tailscale funnel https://localhost:3000/api           # share one path
tailscale funnel /path/to/file-or-dir                 # file/dir sharing
tailscale funnel status [--json]
tailscale funnel <port> off   /   tailscale funnel off
tailscale funnel reset
```

- **Ports restricted to 443, 8443, 10000 ONLY** — a hard Tailscale limit, not an app-level choice
  (confirmed at the implementation level via `serve.IsFunnelPort`).
- **Prerequisites:** Tailscale ≥ v1.38.3, MagicDNS enabled, HTTPS certs enabled, and a `funnel`
  node-attribute grant in the tailnet ACL policy:
  ```json
  {"nodeAttrs": [{"target": ["tag:servers"], "attr": ["funnel"]}]}
  ```
  Running `tailscale funnel` the first time triggers a **one-time web-approval flow** that adds
  this nodeAttr automatically; without it the command fails with a permission error **even for
  admin users**. Default grant target is `autogroup:member`.
- **Platform limitation:** NOT available on iOS, Android, or the macOS App Store Tailscale
  variant — only Linux and the macOS **open-source CLI** variant.
- **Cannot share the same port as Serve simultaneously** — but CAN run on a
  DIFFERENT port than a same-service Serve config, simultaneously (§1).
- Non-configurable bandwidth/rate limits; frequent cert (re-)requests risk Let's Encrypt rate
  limiting (documented as a **~34-hour wait** on frequent requests).
- Public DNS will correctly **NOT** resolve a Funnel `.ts.net` hostname without going through
  Tailscale's relay path — that is by design, not a bug (also
  independently stated: DNS not resolving for public visitors is EXPECTED, not an error).

**How Funnel actually routes traffic:** client requests the Funnel URL → DNS resolves to a
Tailscale relay server (the serving device's real IP is never exposed) → relay opens an encrypted
TCP proxy to the serving device over Tailscale → the relay **cannot decrypt** the traffic (still
end-to-end encrypted) → the serving device terminates TLS and serves content.

**Best practices repeated across sources** (kept as a checklist — do not compress): use Serve for
internal traffic and keep private services private; use Funnel sparingly — only truly public
endpoints; Funnel BYPASSES Tailscale auth, so add your own application-level authentication;
monitor who's connecting; stop serving/funneling when done.

### 5c. Foreground vs `--bg` (background) — the single biggest reported gotcha

**Foreground** (no `--bg`): dies the instant the invoking terminal/session ends. **Does NOT
appear in `tailscale funnel status` / `serve status`** even while it is actively serving traffic
— status prints `"No serve config"` even though it IS working. This is explicitly documented as
**NORMAL and EXPECTED**, not a bug. Verify a foreground Serve/Funnel is really running with:

```bash
ps aux | grep -E "tailscale.*funnel" | grep -v grep
```

**Background (`--bg`):** IS persistent (survives reboot if `tailscaled` is enabled as a system
service — the persistence guarantee is conditional on that, not automatic on every install),
**DOES** show in `status`, and must be explicitly torn down with
`tailscale funnel --https=443 off` (bare Ctrl+C/kill does NOT remove the still-live background
config).

Only ONE Serve/Funnel config can hold port 443 at a time. Switching workflow: check status → stop
the old one (`off`) → verify stopped (`"No serve config"`) → start the new one → verify started.
Error `"foreground already exists under this port"` means another instance is stuck — check BOTH
`funnel status` (background) AND `ps aux | grep "tailscale funnel"` (foreground) before assuming
it's cleared. **Never kill the main `tailscaled` process or `tailscaled be-child ssh` children**
while cleaning up stuck funnel processes — only the `tailscale funnel <port>` child process is
safe to kill (`sudo kill <PID>`, or `-9` as a last resort). `sudo systemctl restart tailscaled`
should be a last resort only — most funnel issues are process-management, not daemon issues.

This is called "the #1 source of confusion".

### 5d. Path management — add/remove semantics, and the two "remove" verbs that get conflated

```bash
# Add (v1.98+, the CURRENT preferred incremental form):
sudo tailscale serve --bg --set-path /<subpath> http://localhost:<port>/

# Remove ONE path:
sudo tailscale serve --https=443 --set-path=<path> off

# Remove ALL paths/config on this node (NODE-WIDE — §0.2, not port-scoped):
sudo tailscale serve reset
```

**Critical footgun, reported by MULTIPLE independent sources:** `tailscale serve --bg <root>`
(i.e. `--bg <port>` with **no** `--set-path`) **REPLACES ALL existing routes** — it does not add
incrementally. Use `--set-path` specifically to add a subpath without wiping the others.
`tailscale serve reset` wipes the ENTIRE config; do not use it when you only meant to remove one
path — use `<path> off` instead.

Serving at `/` (root) silently overrides every other registered path — always run
`tailscale serve status` before adding a new path.

**The `clear` verb — corrected per direct measurement (§0.2).** Node-level path removal has only
two documented primitives beyond `--set-path=<path> off` and whole-config `reset`: some sources
describe NO per-path remove existing at all beyond re-declaring the paths you want to keep
(*"NO per-path remove exists... the only way to 'remove one path' is to re-run serve
with the paths you want to KEEP"* — this appears to describe an OLDER/different CLI surface than
the `--set-path=<path> off` form documented elsewhere; treat as
version-dependent). Separately, ONE source (`/expose` skill, single source, LOW
confidence) called `tailscale serve clear ${PATH_NAME}` to remove one path-mounted handler at the
NODE level — that specific single-path form is **not attested anywhere else**
(independent sources show only `off`/`reset` at node scope). **Direct
measurement confirms `tailscale serve clear <name>` is a real command, but scoped to Services
(`svc:<name>`), not to a bare node-level path** — see §0.2, §5e, and the troubleshooting table in
§6c. Trust `off`/`reset` for node-level paths; trust
`clear svc:<name>` for Services.

### 5e. Tailscale Services (`svc:` / TailVIPs) — a SEPARATE config/status surface from node-level serve

A Service is a named resource with a stable virtual IP (TailVIP, v4+v6) + MagicDNS name +
endpoint definitions + one or more hosts advertising it (GA as of early 2026, available on all
plans — see §1).

**Node-level Serve** (`tailscale serve --https=443 http://127.0.0.1:8080`) attaches to the
CURRENT node's own identity/hostname. **A Service**
(`tailscale serve --service=svc:myapp --https=443 http://127.0.0.1:8080`) proxies for a named
resource with its OWN virtual IP/hostname, independent of which node currently serves it —
enabling later failover/migration.

**Load-bearing gotcha, reported by 2+ independent sources:** `tailscale serve status` with **no
flags shows ONLY node-level routes** — a Service's config is entirely INVISIBLE to it, printing
`"No serve config"` even when the Service is fully configured and traffic is flowing. This looks
exactly like a silent failure and sends people down a rabbit hole of restarting tailscaled /
down-up / re-issuing serve for nothing. **The fix:**

```bash
tailscale serve status --json | jq '.Services'
```

— look under `.Services["svc:<name>"]`, the real source of truth for Service-based proxies.

A Service **must be defined FIRST** in the admin console (Services page: name + port) before
`tailscale serve --service=svc:X ...` has anything to attach to — running the CLI against an
undefined Service **reports success** ("Serve started and running in the background") but nothing
shows as pending and the hostname never resolves. **Reliable stand-up order** (repeatedly
rediscovered per the source):

1. Define the Service in the admin console FIRST (name + port, e.g. 443).
2. Run `tailscale serve --service=svc:X --https=443 <target>` on the proxying host.
3. **Restart `tailscaled`** on that host (`sudo systemctl restart tailscaled`) — **CONFIRMED
   REQUIRED, not optional**. Until the daemon restarts, the pending-proxy registration from step
   2 is not pushed to Tailscale's Services backend, and nothing shows as approvable in step 4.
   Merely toggling `serve ... off/on` is **NOT** a substitute.
4. Approve the pending host in the admin console (Services page).
5. Validate from a **DIFFERENT** node (`curl -fsS https://<name>.<tailnet>.ts.net/<health-path>`)
   — **never** from the serving host itself.

**This "restart required" step is situation-dependent, not universal** — it's confirmed-required
for *bringing up a brand-new Service*, but explicitly discouraged as a *reflexive* troubleshooting
move for an ALREADY-WORKING Service whose status merely looks confusing (the same command applies
differently to a different situation — don't apply the wrong branch).

**No `--accept-routes` is needed for TailVIPs** — clients access via MagicDNS
(`https://webapp.tailnet-name.ts.net`) or the raw TailVIP directly, but this requires client
**v1.94.1+**.

Additional Service quirks:
- `tailscale ping <service-hostname-or-vip>` **always returns `no matching peer`**, even when the
  Service is healthy — a Service's virtual IP isn't a real WireGuard peer, so ping has nothing to
  reach. **Expected, not a failure.** Use `curl` instead.
- **Self-curl from the serving host can hang** (hairpin/self-connect) even when the Service works
  fine for every other node — don't conclude broken from a self-test; verify from a different
  tailnet node. This is distinct from the "no SNI ServerName" TLS-handshake
  failure in §3c (a hang vs. an immediate handshake error) — diagnose which one you actually have.
- Multiple hosts can advertise the SAME Service for HA; Tailscale's Regional Routing steers
  clients to the nearest healthy host automatically. `tailscale serve drain svc:X` stops new
  connections while letting existing ones finish (rolling maintenance); `tailscale serve advertise
  svc:X` brings it back online.
- Limitations: TCP only (no UDP except via L3/`--tun` iptables mode, Linux only); TailVIPs accept
  **incoming** connections only (no outgoing); **no hairpinning** — a host cannot reach the
  Service it itself hosts; `text:`/`file:` targets are CLI-only, unsupported in the declarative
  config file.
- Endpoint layers: `http://`/`https://` (L7, Tailscale terminates TLS), `tcp://`/
  `tls-terminated-tcp://` (L4, no packet modification), `--tun` (L3, full iptables control, Linux
  only).
- Declarative config file form:
  ```json
  {"version":"0.0.1","services":{"svc:webapp":{"endpoints":{"tcp:443":"http://localhost:8096"}},"svc:db":{"endpoints":{"tcp:3306":"tcp://db:3306"}}}}
  ```
  applied with `tailscale serve set-config /path/to/services.json` (re-run to hot-reload without
  restart); inspect with `tailscale serve get-config`.
- **Disabling vs removing a Service's proxy config**: `tailscale serve --service=svc:X ... off`
  disables the Service's proxy config while KEEPING the Service definition; `tailscale serve clear
  svc:X` removes ALL serve config for that Service (§0.2) — the two are not the same operation.

### 5f. `--json` / `set-config --all` — VERSION-GATED, per direct measurement

**`tailscale serve --json` and `set-config --all <file>` were reported BROKEN specifically in
Tailscale CLI v1.98.1**, by 2+ independent sources: `--json` errors
`flag provided but not defined: -json`; `set-config --all <file>` errors `"must specify
filename"` even with a filename given; `get-config --all` returns only `{"version":"0.0.1"}`, not
the full config. Workaround for that version: use `--set-path`/`off` exclusively.

**Directly measured (§0.3): `serve status --json` WORKS in Tailscale CLI
1.98.5** — it returns `{}` with exit code 0 on a node with no serve config. This confirms the
best available framing was correct: **this is a version-specific regression that was already
fixed by 1.98.5, not a universally-broken feature.** Other sources use
`tailscale serve status --json` and `.Services` JSON parsing as their PRIMARY source of truth
without any caveat, and another explicitly recommends
`tailscale serve status --json | jq '.Services'` as the standard fix for the
Services-invisibility gotcha (§5e). **Always verify against the installed `tailscale version`
before assuming either way** rather than defaulting to "broken" or "fine" (tightened by §0.3).

The `tailscale serve --https=<fqdn> ...` flag form is separately reported **DEPRECATED** in favor
of `--bg "http://<fqdn> http://service:port"` `[unverified — no version pinned; see §0]`.

### 5g. General version caveat

*"Serve/Funnel CLI changed in Tailscale 1.52+; use `--help` for exact flags."* — do not assume a
fixed flag surface across old and new Tailscale CLI versions.

### 5h. Serve config persistence and storage

Serve config persists to `/var/lib/tailscale/serve-config.json` on disk, and survives reboot
**only if** the `tailscale`/`tailscaled` systemd service itself is enabled
(`sudo systemctl enable tailscale`) — this is a conditional guarantee, not automatic on every
install. Re-running the same `tailscale serve --bg ...` command
idempotently **REPLACES** the config for that path — this is how the deploy-time host workflow
differs from a pod/quadlet-lifecycle-tied mechanism: it writes to `tailscaled.state` (the
daemon's local BoltDB) with zero pod/service restart required.

### 5i. `get-config`/`set-config` for GitOps-style exposure management

`tailscale serve get-config tailscale-serve.json` /
`tailscale serve set-config tailscale-serve.json` let Serve/Funnel exposure be managed as a
versioned config file — store generated configs only when they contain no environment-specific
secrets, review before committing, and keep the Serve/Funnel config review adjacent to the tailnet
policy review in GitOps flows so access and exposure change together (confidence MED —
brief, general guidance rather than a worked example).

### 5j. Additional CLI surface — DNS, cert helpers, bugreport, admin utilities

- `tailscale dns status` / `tailscale dns query google.com` (v1.74.0+) — see §4g.
- `tailscale cert [--cert-file=<path>] [--key-file=<path>] [--serve-demo]` — see §4b.
- `tailscale bugreport [--diagnose] [--record]` generates a diagnostic ID for Tailscale support
  (`--record` creates two reports with a pause for reproducing an issue in between).
- `tailscale web` opens the local web UI (typically `http://localhost:8008`).
- `tailscale name` / `tailscale id` show the machine name / device id+tailnet info.
- `tailscale --socket=/var/run/tailscale/tailscaled.sock status` for multi-instance / custom
  socket setups.

### 5k. Docker / container serve patterns

**Docker Compose service sharing the Tailscale container's network namespace:**

```yaml
services:
  tailscale:
    image: tailscale/tailscale
    cap_add: [NET_ADMIN, NET_RAW]
    volumes: [tailscale-state:/var/lib/tailscale]
    environment: {TS_AUTHKEY: tskey-auth-<redacted>, TS_EXTRA_ARGS: --hostname=my-service, TS_SERVE_CONFIG: /config/serve.json}
    volumes: [./serve.json:/config/serve.json]
  app:
    image: my-app:latest
    network_mode: service:tailscale
volumes: {tailscale-state: {}}
```

**A userspace-only sidecar with no `NET_ADMIN`/`/dev/net/tun` at all:** `tailscaled
--tun=userspace-networking --socks5-server=localhost:1055` (SOCKS5 proxy for outbound). Health at
`:9002/healthz`, metrics at `:9002/metrics`. Env vars: `TS_HOSTNAME` (required), `TS_STATE_DIR`
(default `/var/lib/tailscale/`, must be a Docker volume to persist login across restarts),
`TS_EXTRA_FLAGS`, `TS_AUTH_ONCE=true` (don't re-auth on restart).

**A direct host-level `tailscale serve --bg` workflow needs zero pod/quadlet changes**, in
contrast to a deploy-time `tunnel: tailscale` field that regenerates a systemd/quadlet unit and
ties the config lifecycle to the pod's create/remove cycle — see §5h for the full contrast.

**A userspace `tailscaled` fallback when only the CLI is installed and no system daemon/socket
exists** (e.g. Homebrew CLI without the system daemon on macOS): when `tailscale status` fails
with a message OTHER than "Logged out."/"NeedsLogin"/"stopped; run" — i.e. no reachable daemon at
all — start a TEMPORARY userspace `tailscaled` scoped entirely under a scratch directory:

```bash
tailscaled --tun=userspace-networking \
  --socket=/private/tmp/remotehost-tailscaled.sock \
  --state=/private/tmp/remotehost-tailscaled.state \
  --statedir=/private/tmp/remotehost-tailscaled
```

`--statedir` specifically matters for HTTPS-Serve certificate material — **omitting it can
produce an HTTPS Serve failure whose `tailscaled` log literally says `no TailscaleVarRoot`**. If
the userspace node shows `offline` in `tailscale status` (stale prior state), the fix is
`--fresh`: archive the old `state`/`statedir` with a timestamp suffix
(`mv "$state_path" "${state_path}.stale-<ts>"`) and start clean, then re-login.

**Gotcha specific to this fallback:** a normal browser on the SAME Mac may still fail to open the
Serve hostname when only this CLI/userspace Tailscale is running — macOS host routing and
MagicDNS aren't installed for a plain browser process in that mode; verify same-host service
health via `127.0.0.1:PORT` instead, and test the actual Serve URL from a genuinely separate
device on the tailnet.

### 5l. `--operator=<account>` — passwordless serve/set for a non-root user context

By default `tailscale serve`/`set` needs root/sudo. `tailscale set --operator="$account"`
(commonly the uid-1000 "first human user") grants a specific unprivileged user permission to run
these commands without sudo — the mechanism that lets user-scoped systemd
quadlets/services invoke `tailscale serve` non-interactively. Verified by
`tailscale debug prefs` succeeding non-root AND showing a non-empty `"OperatorUser":` field.

**`tailscale status`/`tailscale ping` need no sudo at all**, normally readable by any local user.
Mutating commands (`serve`, `funnel`, `up`/`down` in some configs) may need root, OR work
passwordless if the local user is set as the Tailscale operator, OR is granted a scoped
`NOPASSWD` sudo rule for something as narrow as `tailscale serve *`. Symptom of the WRONG scope
being assumed: `sudo tailscale status --json` hangs asking for a password on a host where plain
`tailscale status` works fine AND `sudo tailscale serve status` ALSO works fine — because sudo
was scoped to `serve *`, not to `status`. Fix: drop the unneeded `sudo`, or run `sudo -n -l` to
check what the sudoers rule actually covers before assuming Tailscale itself is broken.

---

## 6. Troubleshooting checklists and lookup tables

### 6a. Connectivity-triage checklist for a production incident

Ordered incident triage, do not skip steps:

1. Is `tailscaled` running and logged in?
2. Does `tailscale status` show both peers?
3. Does `tailscale ping <peer>` work, and via direct/DERP/peer-relay?
4. Does policy allow src→dst:port?
5. For subnet/app-connector routes: advertised, approved, client-accepted, and reachable from the
   router?
6. For DNS: does `tailscale dns status` show the expected MagicDNS/split-DNS config?
7. For Serve/Funnel/Services: does the local serve config expose the expected target+protocol?

Safe read-only commands to start with: `tailscale version`, `status`, `status --json`, `netcheck`,
`ping --verbose <peer>`, `ip`, `dns status`, `serve status`, `funnel status`, `bugreport`; for
systemd hosts add `systemctl status tailscaled` / `journalctl -u tailscaled --since '1 hour ago'`;
for Kubernetes add `kubectl get pods -n tailscale` /
`kubectl logs -n tailscale -l app=tailscale-operator --tail=200`.

A shorter, general form of the same idea, stated independently: *"Determine the path first: LAN,
tailnet, public internet, reverse proxy, or overlay. Check DNS resolution, route, listener,
firewall, TLS/cert, and app health in that order. Prefer tailnet endpoints for private admin
paths. Keep public exposure minimal; put admin UIs behind VPN/SSO/reverse proxy."*

**Diagnostic separation of hops** (test each layer in order, in isolation, before blaming the
next one): always test the local target first
(`curl -v http://127.0.0.1:PORT/`), then the Serve HTTPS frontend
(`curl -vk https://<node>.<tailnet>.ts.net/`, or
`openssl s_client -connect ...:443 -servername ... -brief`), THEN the browser/app behavior
(absolute URLs, WebSocket origins, CORS/dev-origin config). Interpretation table:

| Symptom | Diagnosis |
|---|---|
| Local curl 200 + HTTPS curl TLS-fails | Serve/cert problem, not the app |
| HTTPS curl reaches HTTP but 502 | Serve is fine, proxy target wrong/down |
| HTTPS curl returns app HTML but browser is broken | App/browser-URL problem, not Tailscale |

**Curl from the SAME host that's serving can hang/self-connect-fail
(hairpin issue)** even when the Service works for every other node — never conclude "broken" from
a self-test on the serving host; test from a different tailnet node (§5e). A separate, sharper
failure mode — a TLS handshake error rather than a hang — is the missing-SNI symptom in §3c.

### 6b. Funnel troubleshooting table

| Symptom | Fix |
|---|---|
| "Funnel not enabled" | Run `tailscale funnel` to enable for the tailnet |
| "Certificate not found" / HTTPS error | Ensure HTTPS + MagicDNS are enabled; re-enable Funnel to regenerate certs |
| "DNS not resolved" for public users | **EXPECTED, not a bug** — Funnel hostnames only resolve through the Funnel relay, not public DNS |

### 6c. Serve troubleshooting table

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | Needs root/sudo (or `--operator`, see §5l) |
| `listener already exists` | Port 443 already has serve config — use `--set-path` for sub-paths, or `reset` |
| `Funnel is not enabled` | Needs admin-console activation |
| `502 Bad Gateway` | No service listening on the proxied port |
| URL not resolving | Check `tailscale status` |

Additional diagnostic commands worth keeping alongside this table:
`tailscale status` (peer list + node state, no sudo); `tailscale status --json` (`.Self`,
`.Peer[]`, `.CurrentTailnet`, `.Health`); `tailscale serve status --json` (real Services + node-serve
config); `tailscale ping <peer>` (WireGuard-level reachability, real nodes only); `tailscale
version` (compare across nodes); `tailscale serve --service=svc:X ... off` (disable a Service's
proxy config, keeps the definition); `tailscale serve clear svc:X` (remove ALL serve config for a
Service — see §0.2, §5d, §5e).

### 6d. Security pre-flight checklist before running ANY `tailscale serve` command (agent-facing)

Before executing any serve command:

1. **Is the user asking for PUBLIC access?** Yes → explain Funnel's risks, require explicit
   confirmation. No → use Serve (tailnet-only).
2. **What is being exposed?** A dashboard with personal data → Serve only. Static HTML → Serve is
   fine. A service with write access → extra caution + require app-level auth.
3. **Does the port already have a listener?** Verify with `curl http://localhost:<port>` before
   adding serve, else the path returns `502`.

*"Never default to funnel. Always start with serve."*

### 6e. Never enable Funnel by default — the private-first UX contract

`tailscale serve` (private, tailnet-only) is the default for a well-designed skill/tool;
`tailscale funnel`/an equivalent `--public` flag is used ONLY after the user explicitly wants a
public internet URL and understands the exposure. If the local service exposes workspace files,
authenticated app state, private source, or other sensitive data, the tool must state that risk
and get explicit approval BEFORE starting Tailscale login, daemon setup, Serve, or Funnel — even
for the private-Serve default. Also: never promise a private Serve URL can redirect an
unsigned-in device — an unsigned-in phone literally cannot reach the private URL at all, so no
HTTP redirect can occur there; the correct message is a two-line handoff
(`Tailscale: https://tailscale.com/download` + the private app URL) so the user installs/signs-in
first.

**A concrete implementation of "auto-expire an ad-hoc share":** default every ad-hoc Serve share
to a 1-hour TTL with scheduled auto-cleanup. `share localhost:PORT` defaults `--ttl 1h`;
`--ttl 30m` / `--ttl 2h` override it; `--no-expire` is reserved for an explicit user request for a
persistent share. Cleanup is implemented with a detached background job, NOT relying on
Tailscale's own expiry:

```bash
nohup sh -c "sleep '$seconds'; tailscale serve --https=443 off; tailscale funnel reset; kill <userspace-daemon-pid>" &
```

— i.e. the expiry is enforced by a SEPARATE scheduled process, so if the parent process/session
dies the cleanup job still fires. An `off` subcommand performs the same teardown immediately and
is the standard way to end a share early.

---

## 7. Worked examples / architectures

### 7a. Private-by-default document hosting with opt-in per-document Funnel

Architecture: a renderer converts Markdown → static HTML into a shared dir served by a loopback
`python3 server.py <port> <serve_dir> <skill_dir>` (stdlib `http.server`, no deps), fronted by ONE
`tailscale serve --bg --https=<port> http://127.0.0.1:<PORT>` route (tailnet-only, HTTPS via
Tailscale-managed certs). One document can additionally be opted into the public internet via a
PER-DOCUMENT Funnel **path mount**:

```bash
tailscale funnel --bg --https="$FP" --set-path="/p/$id" "http://127.0.0.1:$SERVEPORT/_pub/$id/"
tailscale funnel --https="$FP" --set-path="/p/$id" off      # unpublish
tailscale funnel status | grep -q "/p/$id "                 # check if published
tailscale serve status | grep "127.0.0.1:$PORT"              # detect existing route (avoid reset)
tailscale serve reset                                         # only on full teardown (--stop)
```

Funnel port picked from `443|8443|10000` (first not already `lsof`-bound); the funnel URL builds
`https://<host>[:<port>]/p/<id>/`. Host resolved at runtime:
```bash
tailscale status --json | python3 -c "...json.load(sys.stdin)['Self']['DNSName'].rstrip('.')"
```
This demonstrates the FULL serve-vs-funnel security model in one working example:
tailnet-private by default, explicit opt-in per-artifact for public exposure, with the
control-plane (publish/unpublish toggle API) kept OFF the public Funnel mount so a public visitor
can reach only the one opted-in document.

**Gotcha:** local nginx often already holds ports 443/8443, so the design auto-falls-back to the
first free HTTPS port (e.g. `:8446`) for the tailnet-only `serve` route — the FUNNEL port is
chosen independently and must still be one of 443/8443/10000. Freshly published Funnel URLs take
a few seconds to warm up — an immediate `curl` may connection-error; retry.

**The public/control separation, implemented:** control routes
(`GET /_ctl/status?id=`, `POST /_ctl/publish {id}`, `POST /_ctl/unpublish {id}`) are reachable
ONLY over the tailnet `tailscale serve` origin — Funnel only ever mounts the narrow `/p/<id>/` →
`/_pub/<id>/` path, never `/_ctl`, so a public internet visitor gets a 404 on the control surface
no matter what. The public-facing handler additionally regex-strips a header/metadata block from
the HTML before it is served under `/_pub/<id>/`, so the public bytes carry NO index link,
session label, date, or original file path — "not even in view-source." The document id itself is
validated with a strict regex (e.g. `^[0-9]{8}-[0-9]{6}-[0-9]+$`) before any filesystem lookup.
**Reusable technique:** a narrow-path Funnel mount (one specific `/p/<id>/` route)
plus a server-side, byte-level metadata scrub is a concrete pattern for "safely expose ONE
artifact from an otherwise-private tailnet service" — stronger than relying on ACLs alone, since
Funnel bypasses tailnet ACLs entirely for the mounted path.

### 7b. HTML reports served privately over Tailscale, with an optional bearer-token publish path

Reports are read as HTML pages over Tailscale rather than pasted into chat. A stdlib-only
threading HTTP server serves a local artifacts directory on `127.0.0.1:<port>` (default `8789`);
`tailscale serve` maps `https://<host>.ts.net/artifacts` to it. A newer/canonical variant
publishes instead via a bearer-token PUT to a centrally-hosted "shelf":

```bash
curl -T page.html -H "Authorization: Bearer $ARTIFACTS_API_TOKEN" \
  https://bastion.example.ts.net/artifacts/a/<slug>/index.html
```

with the local loopback server kept as a legacy mirror/backup. **Gotcha:** files written raw into
the local artifacts directory serve on the LOCAL host only — they still need the bearer-PUT
publish step or they will not appear on the shared/bastion shelf.

### 7c. `secret-intake` — a credential-intake form security architecture

Routing chain:
```
Browser → https://<ts-hostname>/secrets
       → Tailscale Serve (TLS termination)
       → hex-router :8880 /secrets → strip prefix → :9877 /
       → secret-intake server (plain HTTP)
```

Security properties: the server binds to `0.0.0.0` but is only reachable via Tailscale (**no
public exposure** — reachability is enforced purely by the tailnet, not by the bind address);
zero HTTP logging (the log function is a no-op); `Cache-Control: no-store` on every response;
secret values never appear in terminal output/logs/transcripts; secret files are gitignored; form
data is sent via POST body, never URL params. On submit, env vars are written per-institution to a
gitignored `.env` file (merged with existing keys if present), key files similarly, both
`chmod 600`, then a sync step propagates to the running processes that need the values.
**Note what this example does NOT rely on:** it says nothing about `X-Forwarded-For` or
`Tailscale-User-*` identity headers reaching the backend — security here rests entirely on
tailnet-only reachability + TLS termination at Serve, zero logging, and `Cache-Control: no-store`
— contrast with the stricter bind-to-Tailscale-IP-only posture in §2d, which this example
deliberately does not follow.

### 7d. Deriving a share URL end-to-end (find a port, bind loopback, mount, resolve own hostname)

```bash
# find a free local port
python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()"
# bind local HTTP server to loopback ONLY — tailscale handles external access
python3 -m http.server $PORT --directory "$SERVE_DIR" --bind 127.0.0.1 &
echo $! > /tmp/ts-serve.pid
tailscale serve --bg --set-path "/$SLUG" "http://127.0.0.1:$PORT"
# get this node's own MagicDNS name to construct the share URL
tailscale status --self --json | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))"
```

End-to-end recipe for exposing an arbitrary file/dir over Tailscale HTTPS with a clean per-content
URL slug, then tearing it down (`tailscale serve reset`, kill the http.server pid, remove temp
files). **Gotcha:** "Always bind the HTTP server to 127.0.0.1 — Tailscale handles external
access." `tailscale serve --bg` persists until explicitly reset. The HTTPS certificate is
auto-provisioned by Tailscale. If `tailscale serve` fails, fall back to printing the raw
`http://<ts-ip>:<port>/<filename>` URL and tell the user `tailscale serve` may need to be enabled
in the admin console. **Don't hardcode/record the derived URL** — Serve config is local
Tailscale state, intentionally not committed to git; always re-discover the live URL via
`tailscale serve status`.

### 7e. A mobile-accessible viewer served over a `.ts.net` hostname

Canonical URL shapes: `https://<host>.tail<id>.ts.net/artifacts` (gallery UI),
`https://<host>.tail<id>.ts.net/artifacts/a/{artifact_id}` (per-artifact viewer), with the backing
API on `http://127.0.0.1:8080/...` (loopback only — the `.ts.net` hostname is the only externally
reachable form). Turns generated local files/folders on a headless VPS into stable HTTPS links
openable from a phone (Telegram/WhatsApp/Discord/browser) instead of handing the user a raw
filesystem path. **Gotcha:** *"the gallery only serves allowlisted roots and refuses
credential/dot/secret-like paths. If registration fails, do not bypass it by inventing a URL; fix
the path/root or report the failure."*

### 7f. Bridging a self-hosted skill/gateway to a chat-bot slash-command surface

A chat-bot skill can wrap the underlying Tailscale primitives behind slash commands: `/tailscale
serve|funnel|status|ip|peers|ping|send|receive`, backed by calls like
`tailscale.serve({port, protocol, path, hostname})`, `.serveStop(port)`, `.serveStatus()`,
`.funnel({port, protocol, hostname})`, `.funnelStop(port)`, `.funnelStatus()`, `.status()`,
`.peers()`, `.ping(hostname)`, `.sendFile({file, peer})`, `.receiveFile({savePath, timeout})`,
`.getIP()`, gated on a `TAILSCALE_AUTHKEY` env var. **Reusable gotcha:** the implementation checks
`client.isInstalled()` and `client.isRunning()` BEFORE calling status, returning distinct
user-facing messages for "not installed" vs "installed but not running" vs live status — never
assume the daemon is up just because the binary exists.

### 7g. Cross-checking a viewer's health from three independent signals at once

A status script that checks LaunchAgent state (e.g. `launchctl list <label>`), the local `/health`
endpoint, AND `tailscale serve status` together in ONE combined report is explicitly called out as
"the safest first command," because it correlates all three signals rather than trusting any one
of them alone. The skill's stated boundary in this example is Serve (private,
tailnet-only) ONLY — Funnel is explicitly out of scope and never enabled by this design.

### 7h. Loopback-bind + auth-on-top, discovered rather than hardcoded

*"Bind the local server only to `127.0.0.1:<port>`… Use `tailscale serve`, never `tailscale
funnel`. Funnel is public."* — combined with HTTP Basic auth kept enabled on top, with the
password stored ONLY in the OS keychain, never printed/argv'd/committed. A persistent
background mapping (`tailscale serve --bg http://127.0.0.1:<port>`) is then discovered via
`tailscale serve status` at read time rather than recorded anywhere durable — the
security model here is entirely "private service, reachable only inside the tailnet, authenticated
on top of that."

### 7i. Exposing a locally-bound dashboard over HTTPS to tailnet members only (Docker port mapping)

Given a service bound only to `localhost` on some port — found e.g. via `docker ps` port
mapping like `0.0.0.0:44452->44452/tcp` (the container's own port mapping may print `0.0.0.0`,
but the intent is still that only tailnet members should ever reach it, enforced separately by
a firewall layer — see the companion UFW recipe in `references/routing-and-topology.md` §2) —
expose it over HTTPS to the tailnet with:

```bash
sudo tailscale serve --bg http://localhost:YOUR_PORT
```

Check the resulting configuration:

```bash
tailscale serve status
```

This reports the `ts.net` HTTPS URL that now fronts the local service, of the form:

```
https://srv1234567.tail8328fe.ts.net
```

That URL is reachable from ANY device also joined to the same tailnet (after
installing/authenticating the Tailscale client there), and is NOT reachable from the public
internet at all once the local firewall also blocks the raw port. Verification is two-sided:
the `ts.net` URL should load from a tailnet-joined device (even over mobile data, via the
Tailscale app), while the raw `http://<public-ip>:<port>` should NOT load from anywhere.

### 7j. Delivering an OTA (over-the-air) iOS app install link when the device can't be recognized directly by Xcode

Installing an iOS build onto a real iPhone has two paths: (1) direct install via Xcode when the
Mac can see the device over USB/Wi-Fi debugging, or (2) a manual OTA link when the device is
not recognized by Xcode (trust dialog not accepted, Developer Mode not enabled, USB pairing not
done, or the Mac and iPhone are not on the same Wi-Fi for wireless debugging) — or the user
simply wants a link-based install instead.

**Decision rule:** if `xcodebuild -showdestinations` lists only the generic `Any iOS Device`
(no concrete device UDID), the direct USB/Xcode device link is not actually established —
explain why, then fall back to the OTA path.

**OTA path — what the automation does:**

1. `xcodebuild archive` to produce an `.xcarchive`.
2. `xcodebuild -exportArchive` to export an `.ipa` from it.
3. Generate a `manifest.xml` and an `index.html` (a one-tap install page).
4. Start a local `http.server` bound ONLY to `127.0.0.1` (not exposed on the LAN or public
   internet by itself).
5. Use `tailscale serve` to expose that local HTTP server as HTTPS to the tailnet.
6. Print the final install link, to be opened in Safari on the iPhone.

**Why `tailscale serve` specifically** (rather than just binding the HTTP server to `0.0.0.0`
and opening a LAN/firewall hole): iOS's OTA install mechanism (the `itms-services://` manifest
flow) REQUIRES HTTPS, and `tailscale serve` supplies TLS termination plus a stable `ts.net`
hostname for a server that only ever bound to loopback — combining "only reachable by tailnet
members" with "HTTPS as iOS requires" in one step, without a separately provisioned TLS
certificate.

**Common failure modes and where to look:**

- iPhone says "Unable to Install" / "Cannot Verify App": usually the provisioning profile does
  not include that iPhone's UDID (a development/debug build requires the device to be
  pre-registered in the Apple Developer account) — register the device and re-sign/re-export.
- The install link opens but the download fails: check that the iPhone is actually connected to
  Tailscale, and check `tailscale serve status` on the host to confirm the serve configuration
  is still active.

---

## GAPS

The following are genuinely **not covered here** (sources flagged them explicitly as gaps, not
as "confirmed no issue" findings), or remain only partially resolved even after the direct
measurement in §0 — verify against current upstream Tailscale docs before asserting either way:

- **Mobile-specific secure-context / `isSecureContext` requirements** for Serve access from
  Safari/Chrome on iOS, distinct from the general MagicDNS/HTTPS-cert prerequisites already
  covered in §4. Not covered here.
- **`X-Forwarded-For` header support for HTTP Serve/Funnel proxying** — still not confirmed or
  denied anywhere. `--proxy-protocol` is documented (a distinct, non-header,
  opt-in mechanism, §2b) as the ONLY forwarding mechanism for the real client IP. The
  §0.1 measurement (the backend sees every caller as `::ffff:127.0.0.1`) explains why the absence
  of a forwarded-IP header is structurally unsurprising for the identity-header mechanism, but it
  does NOT resolve whether Tailscale ever sets such a header for other purposes (logging,
  rate-limiting) — that remains an open question.
- **Framework-specific reverse-proxy breakage beyond Streamlit/SearXNG/SPA-in-general (§3a).**
  Next.js specifically was tested and NOT reproduced (§0.4) — treat that one
  framework as addressed. No source discusses static-export-SPA-framework-specific or other
  named-framework Serve/Funnel incompatibilities beyond what §3a already covers; that remains a
  gap.
- **Whether `tailscale serve clear <path>`** (a single NODE-level path, as opposed to
  `clear svc:<name>` for Services — see §0.2 and §5d) **is a real, differently-versioned CLI verb
  or an author error** in the one skill that used it. Direct measurement
  confirmed `clear` is real for Services; it did NOT confirm or deny the node-level single-path
  form, which remains single-sourced and unattested elsewhere.
- **The exact ACL `nodeAttrs` grant syntax for Funnel** is now better attested than the earlier
  single error-message inference suggested: one source inferred it from an error string
  (confidence MED), but two others independently give worked example
  policy fragments (§4a). Treat this specific gap as **largely resolved**, though
  none of the three sources shows a full end-to-end "before/after" admin-console screenshot-level
  walkthrough of granting it.
- **Whether `tailscale serve --https=<fqdn> <target>` is a deprecated flag form** in favor of
  `--bg "http://<fqdn> http://service:port"` — one source states this with no version pinned;
  not independently checked (see §0, closing note).

### Content reviewed but out of scope for THIS reference (not folded in, not a gap)

A few topics are adjacent to but distinct from serve/funnel/TLS-certs, and were deliberately
left out of the sections above rather than forced in: Node Sharing is noted only as a disambiguation in §1 (its full admin-console mechanics belong
in a device-management reference); ACL Grants syntax (`app`/`ip`/`via`/`srcPosture` fields) and
the general ACL-policy-generator/validator tooling belong in an access-control reference, not
here — the one Grants detail that IS relevant (Funnel's `nodeAttrs` gate) is already covered in
§4a/§5b; alternative mesh-VPN products (Nebula, ZeroTier) are unrelated to Tailscale's own
serve/funnel/TLS mechanics and were excluded entirely.
