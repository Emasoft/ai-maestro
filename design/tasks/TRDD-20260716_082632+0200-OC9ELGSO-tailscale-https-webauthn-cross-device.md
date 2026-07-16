---
trdd-id: OC9ELGSO
title: Tailscale-native HTTPS + host-derived WebAuthn RP_ID for cross-device passkeys
column: planned
created: 2026-07-16T08:26:32+0200
updated: 2026-07-16T08:32:00+0200
current-owner: opus-governance-rules-session
task-type: feature
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T08:26:32+0200
derived: false
labels: [security, webauthn, tailscale, network, passkey]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-16

**MANDATED by the USER on 2026-07-16, born approved.** Verbatim thread: after shipping
TRDD-7U927FCM (multi-channel recovery), the USER asked how a REMOTE device (iPad on Tailscale)
verifies identity; on learning passkeys are `localhost`-bound and password-only remotely, then
that MagicDNS is the missing piece, they said *"yes [write the TRDD], and plan to make the
magicdns work on android too and to my office windows pc too."*

**This is a PLAN, not yet implemented.** No code has been written for it. It is a scoped
infra+auth feature, deliberately SEPARATE from the (shipped) recovery work.

**The one-sentence goal:** make the passkey a UNIVERSAL identity factor across every device on
the tailnet (Mac at the desk, iPad, Android phone, office Windows PC) instead of a
localhost-only factor — by serving the dashboard over Tailscale-issued HTTPS on the host's
`*.ts.net` name and deriving the WebAuthn RP_ID from the request host (allow-listed), so one
iCloud/credential-manager-synced passkey works everywhere.

**NEXT ACTION:** Phase 1 — add TLS termination to `server.mjs` using a `tailscale cert`-issued
cert for the host's `*.ts.net` name, WITHOUT `tailscale serve` (it breaks Next.js static
serving — verified in project memory `network_tailscale_ipad.md`). Keep the existing
`isAllowedSource` Tailscale IP filter in front of it.

**Load-bearing facts (verified against current code, 2026-07-16):**
- `lib/webauthn-server.ts:61-62` hardcodes `RP_ID='localhost'` + `ORIGIN='http://localhost:23000'`.
  The comment at `:43-60` already names the fix (derive RP_ID from `request.headers.host` with a
  strict allow-list) and marks it NOT DONE. This TRDD IS that work.
- `app/api/auth/login/route.ts` is password→`aim_session` cookie; NOT console-gated, so remote
  login already works — the password is the remote factor today. This TRDD adds the passkey factor
  remotely; it does not change the password path.
- WebAuthn hard constraints (spec, not ours): (1) RP_ID must be `localhost` or a real registrable
  domain — **a bare IP (`100.x.x.x`) is NOT a valid RP_ID**; (2) the origin must be a **secure
  context** — `https://` OR `http://localhost` — so `http://<host>.ts.net:23000` is REJECTED by the
  browser regardless of RP_ID. Both are why plain-IP + plain-HTTP over Tailscale can never do passkeys.
- Project memory: iPad reaches the host at the raw Tailscale IP `100.99.233.43:23000`; iOS Tailscale
  "doesn't resolve `.ts.net` reliably"; the historical TCP blocker (an orphaned ProtonVPN WireGuard
  extension) is already fixed. See `network_tailscale_ipad.md`, `network-security-model.md`.

**The canonical-origin decision (the crux — pick at Phase 2):**
- **Option A (RECOMMENDED): single canonical origin = `https://<host>.ts.net:23000` for EVERY
  device, including the Mac.** One RP_ID (`<host>.ts.net`) ⇒ ONE passkey, synced by
  iCloud Keychain / Google Password Manager / Windows Hello across devices ⇒ register once, use
  everywhere. Cost: the Mac stops using `http://localhost:23000` as the dashboard URL, and any
  EXISTING localhost-registered passkey stops working (different RP_ID) ⇒ a one-time re-register.
- **Option B (fallback): dual origin** — keep `localhost` (RP_ID=localhost) AND add `<host>.ts.net`
  (RP_ID=that). Two RP_IDs ⇒ a separate passkey per origin, no cross-device sync benefit. More
  permissive, less elegant. Use only if dropping localhost proves impractical.

**MULTI-HOST + the Windows/WSL constraint (USER, 2026-07-16 — "Both").** The office Windows PC
is BOTH a client of the Mac host AND its own ai-maestro host running under **WSL** (WSL is
required to run ai-maestro on Windows — the server is node-pty/tmux/Unix). This adds two things:
- **Identity is PER-HOST, so "one passkey everywhere" is scoped to ONE host's clients, not across
  hosts.** Each ai-maestro instance has its OWN governance domain (its own `governance.json`,
  `system-owner`, `webauthn-credentials.json`) and its own `*.ts.net` name ⇒ its own RP_ID ⇒ its
  own passkey. So: all devices browsing the Mac host at `mac.ts.net` share ONE synced passkey
  (Option A's win); the Windows-hosted instance at `winhost.ts.net` is a DIFFERENT RP_ID with its
  OWN passkey. Do NOT promise a single passkey spanning the two hosts — that is a different
  (cross-host federation) problem, out of scope here.
- **The Windows host needs a WSL-networking sub-design** so tailnet peers can reach its
  in-WSL server at `winhost.ts.net:23000` over HTTPS. Recommended path **W1: run Tailscale
  INSIDE WSL** (co-locates the tailnet node + `tailscale cert` + the server in one Linux env — no
  Windows↔WSL port-proxy, no cert-file bridging; needs `tailscaled` running via systemd-in-WSL or
  a launch shim, and TUN/`/dev/net/tun`, else `--tun=userspace-networking`). Fallback **W2:
  Tailscale on Windows + WSL2 "mirrored" networking mode** (Win11 22H2+, GA) so WSL shares the
  Windows interfaces and an in-WSL `0.0.0.0:23000` bind is reachable at the Windows Tailscale IP;
  cert issued on Windows must be shared into WSL via `/mnt/c/…`. Last-resort **W3: `netsh
  interface portproxy`** Windows→WSL-VM-IP (brittle — the WSL IP changes on reboot). **Verify at
  implementation:** their Windows build's mirrored-mode availability, systemd-in-WSL, and
  Tailscale-in-WSL TUN support — do not assume.

**SUPERSEDED / rejected:** `tailscale serve` for HTTPS — it breaks Next.js static file serving
(project memory). TLS must terminate INSIDE `server.mjs`.

**Verify at implementation (marked because a plan must not assert the untested):**
- that `https.createServer` in `server.mjs` composes cleanly with the existing `::`/`0.0.0.0`
  bind + the TCP-level `isAllowedSource` filter + the WebSocket upgrade handler;
- the current `tailscale cert <name>` invocation + where it writes the cert/key + its renewal
  cadence (~90-day Let's Encrypt) on THIS host's Tailscale version;
- per-OS MagicDNS behaviour: which exact toggle each of macOS/iOS/Android/Windows needs, and
  whether a second VPN/DNS profile is fighting Tailscale for DNS on each (the iPad's root cause
  class).

---

## Problem

The passkey (WebAuthn) factor — the strongest, device-bound identity proof — only works at the
physical Mac via `http://localhost:23000`. From any other tailnet device (iPad, Android, office
Windows PC) it is unusable, so those devices fall back to the governance password. The USER wants
every device to be a first-class MAESTRO device with the same strong factor. Two WebAuthn spec
constraints block the current setup (bare-IP RP_ID; non-secure origin), and one code constraint
(hardcoded `localhost` RP_ID). MagicDNS + Tailscale HTTPS + a host-derived RP_ID together remove
all three.

## Goal / desired outcome

- The dashboard is reachable at `https://<host>.ts.net:23000` from every tailnet device.
- A passkey registered once (ideally on the Mac) is usable on the iPad, Android phone, and Windows
  PC via each platform's synced credential manager — no per-device registration in the ideal path.
- The Tailscale IP filter (`isAllowedSource`) stays: only tailnet peers reach the port; identity is
  still proven per-request (passkey or password), never by network position.
- The password + email-recovery factors are unchanged and remain the fallback.

## Design

### Server (AI Maestro code — this repo's engineering)

1. **HTTPS in `server.mjs`.** Terminate TLS in the custom server using a `tailscale cert`-issued
   cert/key for `<host>.ts.net`. Do NOT use `tailscale serve`. Preserve: the dual-stack bind, the
   TCP `isAllowedSource` filter (runs first), the WebSocket upgrade handler, and headless mode.
   Config-gated so a host WITHOUT a Tailscale cert keeps serving plain HTTP on localhost (no
   regression for the local-only operator).
2. **Host-derived RP_ID + origin** in `lib/webauthn-server.ts`. Replace the two hardcoded
   constants with a function that reads the request `Host` header and maps it to `{rpID, origin}`
   ONLY if the host is in a strict allow-list (localhost + the configured `*.ts.net` name(s)). Any
   other Host ⇒ reject (anti RP-spoofing). `expectedOrigin` must match scheme+host+port exactly;
   `rpID` is the bare hostname.
3. **Canonical origin = Option A** (single `*.ts.net`), unless Phase 2 finds a blocker ⇒ Option B.

### Per-device MagicDNS (device-side config — USER-performed, not AI Maestro code)

AI Maestro cannot configure the user's devices; this is a runbook the USER applies, and a
prerequisite for the passkey factor to be reachable on each device. Common root cause across all:
**only one VPN/DNS provider can own a device's resolver at a time** — a second/orphaned VPN
profile breaks MagicDNS (the iPad's ProtonVPN case). Tailnet-wide, MagicDNS + "override local DNS"
must be enabled in the Tailscale admin console.

- **macOS (the host + desk use):** MagicDNS works natively; ensure "Use Tailscale DNS" is on. The
  host also needs to resolve its OWN `*.ts.net` name and trust the `tailscale cert`.
- **iPadOS / iOS:** enable MagicDNS in the Tailscale app; ensure NO conflicting VPN/DNS profile is
  active (remove orphaned ProtonVPN/other WireGuard extensions — the documented iPad blocker).
  Verify `<host>.ts.net` resolves before expecting passkeys.
- **Android:** enable MagicDNS in the Tailscale app; Android allows only one active VPN — disable
  any second VPN; confirm resolution.
- **Windows (office PC) — as a CLIENT of the Mac host:** the Windows-native browser (Edge/Chrome)
  + Windows Hello for the passkey. Tailscale for Windows has MagicDNS built in; enable "Use
  Tailscale DNS settings" so `mac.ts.net` resolves. WATCH for a corporate/office DNS policy or a
  second corporate VPN that overrides the resolver — the most likely office-environment blocker;
  may need IT cooperation or a split-DNS entry. (If the browser runs INSIDE WSLg instead of native
  Windows, the WSL-DNS caveats below apply.)
- **Windows (office PC) — as a HOST (ai-maestro under WSL):** see the "Windows/WSL host" design
  subsection below — this is the meaty part (where Tailscale runs, cert issuance, in-WSL bind
  reachability, MagicDNS-in-WSL).

### Windows/WSL host (USER: the office PC is "Both" — client AND a host under WSL)

The ai-maestro server (node-pty/tmux/Unix) runs INSIDE WSL2. WSL2 is a lightweight VM with its
own NAT'd virtual NIC — NOT the Windows network stack — so making an in-WSL `:23000` reachable at
`winhost.ts.net` over HTTPS is the crux. Three approaches, recommended order:

- **W1 (RECOMMENDED) — Tailscale INSIDE WSL.** WSL becomes its own tailnet node with its own
  `*.ts.net` name; `tailscaled` runs in WSL (systemd-in-WSL, or a launch shim), needs
  `/dev/net/tun` (else `tailscale up --tun=userspace-networking`). Then the server binds in WSL,
  Tailscale-in-WSL advertises it, and `tailscale cert winhost.ts.net` runs in WSL and writes the
  cert/key right where `server.mjs` reads them. Cleanest for the HTTPS+RP_ID story — everything is
  in one Linux env, no Windows↔WSL bridging.
- **W2 (FALLBACK) — Tailscale on Windows + WSL2 mirrored networking** (Win11 22H2+, GA). WSL shares
  the Windows interfaces, so an in-WSL `0.0.0.0:23000` bind is reachable at the Windows Tailscale
  IP/name. Simpler daemon story (Tailscale native), but the cert is issued on Windows and must be
  shared into WSL (`/mnt/c/…`), and passkey RP_ID must match `winhost.ts.net` (the Windows node's
  name).
- **W3 (LAST RESORT) — `netsh interface portproxy`** Windows:23000 → WSL-VM-IP:23000. Brittle: the
  WSL2 VM IP changes on reboot, needing a re-proxy hook.

Once reachable over HTTPS at `winhost.ts.net`, the SAME server code from P1/P2 applies unchanged:
TLS in `server.mjs` (cert from `tailscale cert`), host-derived RP_ID allow-listing `winhost.ts.net`.
The Windows-hosted instance then has its OWN passkey (per-host identity, per the STATE note).

**Verify at implementation:** their exact Windows build (mirrored-mode availability), whether
systemd-in-WSL is enabled, Tailscale-in-WSL TUN support, and how `tailscale cert` renewal is driven
inside WSL (P4's renewal must work in the WSL environment too).

## Phases

- **P1 — HTTPS in `server.mjs`** (≤3 files: `server.mjs` + a small cert-resolver lib + config).
  `tailscale cert` cert/key loaded; TLS on 23000; IP filter + WS upgrade intact; plain-HTTP
  localhost fallback when no cert. Verify: `curl https://<host>.ts.net:23000/api/sessions` → 401
  from a tailnet peer; localhost dev still works.
- **P2 — host-derived RP_ID** (`lib/webauthn-server.ts` + the webauthn routes). Allow-list; commit
  the Option A/B decision. Unit-test: allow-listed host → correct {rpID, origin}; unknown host →
  reject (RP-spoof guard).
- **P3 — per-device MagicDNS runbook + live verify.** Author the device runbook (docs). USER
  applies it per device; verify a passkey registered on the Mac authenticates on the iPad, then
  Android, then Windows. Each device is a real end-to-end check.
- **P4 — cert renewal + docs.** Automate `tailscale cert` renewal before ~90-day expiry (a
  cron/daemon step) with fail-safe (expired cert ⇒ fall back to password login, never a hard
  lockout). Document the whole setup in `docs/` (macOS host + the Windows/WSL host).
- **P5 — Windows/WSL host bring-up.** Stand up the second ai-maestro host on the office Windows PC
  under WSL: pick W1/W2/W3, get `winhost.ts.net` reachable over HTTPS (P1 code), apply P2's
  RP_ID allow-list for `winhost.ts.net`, register its own passkey, and P4's renewal in the WSL
  env. Verify: a tailnet device authenticates to the Windows instance at `https://winhost.ts.net:23000`
  with a Windows-instance passkey. (Env/IT config is USER-performed; the server code is P1/P2.)

## Derived tasks (to be authored as their own TRDDs when P-work reaches them)

- **NPT — MagicDNS enablement + verification runbook** per device (iOS/Android/Windows/macOS). A
  prerequisite for P3's live verification; USER-performed device config, so it is a doc+checklist
  task, not code. Blocks P3 only.
- **NPT — Windows/WSL host environment bring-up** (Tailscale-in-WSL vs mirrored-mode decision,
  `tailscaled`/systemd-in-WSL, TUN, `tailscale cert` in WSL, corporate-DNS/second-VPN
  reconciliation). USER/IT-performed env config; a prerequisite for P5's server work. Likely splits
  into its OWN TRDD when P5 reaches dev (a peer-host-under-WSL deployment is atomic in its own
  right). Blocks P5 only.
- **EHT — cert-renewal automation** (consequence of adopting TLS; without it the dashboard breaks
  at cert expiry). Fail-safe to password login.
- **EHT — passkey re-registration migration** (consequence of Option A's RP_ID change): existing
  localhost passkeys stop working; the UI must detect zero-valid-passkeys-for-this-origin and
  prompt a fresh registration, and the docs must call it out.
- **EHT — RP-spoofing test + security doc** (consequence of host-derived RP_ID): a test proving a
  non-allow-listed Host is rejected, and a note that widening the allow-list needs security review.

## Estimated risk

HIGH-ish. It changes the SERVER'S listener (TLS in `server.mjs`) and the AUTH origin model — a bug
in either can lock the dashboard or silently disable passkeys. Mitigations baked in: config-gated
HTTPS with a plain-HTTP fallback, password login untouched as the always-available factor, strict
RP_ID allow-list, cert-expiry fail-safe. The per-device MagicDNS half is low-risk (device config)
but has an external dependency (office IT / DNS policy on the Windows PC) outside our control.

## Verification

- P1: HTTPS reachable at `https://<host>.ts.net:23000` from a tailnet peer (401 on `/api/sessions`);
  localhost plain-HTTP dev unaffected; WebSocket terminal still streams; headless mode unaffected.
- P2: unit tests for the host→{rpID,origin} allow-list (accept known, reject unknown); `tsc` +
  `yarn build` green.
- P3: a Mac-registered passkey authenticates on iPad, Android, and Windows (three live checks).
- P4: forced cert-expiry test → dashboard degrades to password login, never a hard lockout.

## Relationship to other work

Builds ON TRDD-7U927FCM / TRDD-P7XKV3N9 (the passkey factor + multi-channel recovery) — it makes
that factor usable beyond localhost. It is NOT a derived task of them (they are shipped and do not
depend on it). Standalone feature, USER-mandated.

## Approval log
- 2026-07-16T08:26:32+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. Verbatim directive in the STATE block.
  No approval request was sent.

## Notes and lessons learned
