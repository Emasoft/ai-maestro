---
name: governance-password-invalidation
description: "how does the user rotate / revoke / reset the governance password / forgot password / password leaked, must change it / next login asks to create a new password / why is a route denied only from my phone but works on the Mac (console_required 403) / how does a route know the real client IP / x-forwarded-for spoof / server crashed at boot 'does not provide an export named' after adding a lib import to server.mjs — the invalidate-by-possession + console-presence design (TRDD-P7XKV3N9)"
ocd: 2026-07-13
lmd: 2026-08-02
metadata:
  node_type: memory
  type: project
  tier: component
  topic: security-and-auth
  functionality: security
  globs: ["app/api/governance/password/invalidate/route.ts", "lib/peer-address.mjs", "lib/governance.ts", "lib/setup-bootstrap.ts", "server.mjs"]
---

# Revoke the password with the password; prove presence with a desktop code (TRDD-P7XKV3N9)

`POST /api/governance/password/invalidate` lets the human ROTATE the governance
password in-product. It is the fix for a leaked credential, and it is what makes
rotation cheap enough to actually happen (before it, rotation had no in-product
path — you edited `governance.json` by hand).

**The flow — two POSTs to the same route:**
1. `{ password }` → the server verifies possession, dispatches a one-shot CODE to
   this machine's desktop, replies `{ codeRequired, channel, hint }` — **the code
   is NOT in the response.**
2. `{ password, code }` → verified ⇒ `invalidatePassword()` runs ⇒ `{ invalidated }`.

Next login then asks the user to CREATE a new password. The credential is never
replaced with a known value, so there is no window in which a leaked password is
still live.

**Two factors, because possession alone must not rotate the master credential:**
- the **password** proves you KNOW the secret;
- a **code on the desktop** proves you are AT the machine. It rides the host OS's
  own notification channel (macOS/Linux/Windows), never HTTP. An attacker holding
  the password but not sitting at the console cannot read it. **That is the whole
  security property** — the moment the code travels over HTTP, the feature is theater.

**Reuse, not reinvention:** the code mechanism is `lib/setup-bootstrap.ts`
(`startSetupFlow` / `verifySetupCode`, SEC-PHASE-6) — the SAME OS-notification
code that first-run setup uses (hashed record, timing-safe compare, one-shot
consume, attempt cap). Throttling is `lib/rate-limit.ts` (`checkAndRecordAttempt`).
Do not write new notification or throttle code — these already exist.

**`invalidatePassword()` DESTROYS the hash** (sets `passwordHash: null` +
`passwordInvalidatedAt`), it does not set a "revoked" flag beside a still-valid
hash. Every caller reads `passwordHash` without also checking a flag, so a flag
would leave a bypassable credential on disk. `setPassword()` CLEARS
`passwordInvalidatedAt` — else the host is bricked in reset mode (create a
password, log in, be told to create a password, forever). `/api/auth/session`
returns `passwordInvalidatedAt` so the UI can say WHY it is asking (a forced
revocation and a fresh install both present as "no password", and "welcome, pick a
password" is the wrong thing to say to someone whose credential was just revoked).

**Scope of the console gate — read the census at its source, never here.** The
authoritative, categorised list of `isConsolePeer()` callers lives in
`lib/peer-address.mjs`'s own docstring, beside the function. **Do not restate it on this
page** — that is precisely what drifted.[^3]

What is stable and belongs here: the gate is a *presence* factor, **not** a general
authorization signal. Every other route stays usable from any device on the Tailscale VPN,
because remote work from a phone is a feature — do not copy the loopback check to a new route
without the same deliberate ruling. And the security work is done by the **code (the PIN), not
the IP**: the IP only decides whether a code is issued at all.

**Two surfaces, zero policy in them** — the settings-page **Revoke** button
(`components/governance/RevokePasswordDialog.tsx`) and the CLI verb
(`aimaestro-governance.sh invalidate-password`, TTY prompt, never argv). Both only
POST and render what the endpoint says. Every gate lives in the endpoint, because
**every route is curl-able**: a check placed in a client is skippable with one
curl, so it is not a weak check, it is no check.

**Governs / see also:** the project's security model and network perimeter —
[[network-security-tailscale-bind]], plus `lib/tailscale-detect.mjs` (`isAllowedSource`) and
`lib/peer-address.mjs`, which are the perimeter + trusted-peer plumbing this page's
console gate rides on — and the still-open successor **TRDD-9MZQ4T7E** (the general
TTY→sudo-token path for OTHER strict routes — this endpoint sidestepped it by
self-authenticating). **MAESTRO login is NOT console-gated** (`app/api/auth/login/route.ts`
contains no `isConsolePeer` call): §2b scoped the rule to two operations and only the
password-change half was ever built.

## See also

- [[network-security-tailscale-bind]] — the surrounding network model: why the perimeter is the
  network but the gate is identity, and why this op's console check is a deliberate, narrow
  exception rather than the general rule.

## Notes and lessons learned

[^1]: [ocd:2026-07-13 lmd:2026-07-13] **A route CANNOT trust `x-forwarded-for` /
  `x-real-ip` for a security decision — the client sets them.** A route handler
  gets a `Request`, never a socket, and every existing route in this repo reads the
  client IP from those headers. A phone on the VPN sends `X-Forwarded-For:
  127.0.0.1` and defeats any naive loopback check. FIX: `server.mjs` — the one
  place that can see the real TCP peer — **DELETES any inbound `x-aim-peer` and
  re-stamps it from `req.socket.remoteAddress`** at the top of the request handler;
  `lib/peer-address.mjs` is the ONLY sanctioned reader. We are behind no proxy
  (localhost + Tailscale direct), so the socket address IS the client address. A
  test asserts the *delete itself*, because without it the spoof test still passes
  while the system is wide open. VERIFY the spoof from a genuinely REMOTE peer (this
  host's own Tailscale IP) — curling from loopback proves nothing (the peer really
  is 127.0.0.1, so it 401s either way); only a remote source turns the forged
  `X-Forwarded-For: 127.0.0.1` into a real test (it must still 403). Also:
  `isConsolePeer` must accept `::ffff:127.0.0.1` — the Tailscale `::` bind is
  dual-stack and Node reports an IPv4 client in that v4-mapped form; miss it and the
  owner is denied at their own keyboard.

[^2]: [ocd:2026-07-13 lmd:2026-07-13] **`server.mjs` CANNOT import a `.ts` module —
  it crashes at boot** with `SyntaxError: The requested module './lib/foo' does not
  provide an export named 'X'`, and pm2 crash-loops (`errored`, dozens of restarts).
  `package.json` runs `tsx server.mjs`, which tempts you to think `.ts` imports
  resolve — they do not, for `server.mjs`'s own top-level imports. The convention was
  already visible: EVERY server-shared module in `lib/` is `.mjs`
  (`hosts-config-server.mjs`, `ecosystem-state-paths.mjs`), and TS files import THOSE
  happily (`lib/messageQueue.ts`). Lesson: a shared module that `server.mjs` must
  import is `.mjs` with JSDoc types, consumed by both worlds. The convention was the
  evidence; "but tsx runs it" was a guess that took the server down. ALWAYS restart
  pm2 and curl a route after touching `server.mjs`'s imports — a green `tsc` does not
  prove the server boots.

[^3]: [id:ATOM-CONSOLE-CENSUS, status:valid, keywords:"console gate gates exactly two operations isConsolePeer callers miscounted maestro login console-gated", ocd:2026-08-02, lmd:2026-08-02]
  DO NOT state how many operations the console gate binds anywhere but beside
  `isConsolePeer()` itself, BECAUSE this page asserted **"TWO operations, nothing else …
  gates MAESTRO login and MAESTRO password-change ONLY"** and both halves were false:
  `grep -rn isConsolePeer app lib` finds **five** call sites (`settings/edit`,
  `statusline/ingest`, `password/reset`, `password/invalidate`,
  `oauth-rotator/reauth-guard`) and **`app/api/auth/login/route.ts` contains none** — the
  one operation the sentence named first is the one that never had the gate. The page even
  contradicted itself, saying "MAESTRO login is not yet console-gated" fifteen lines lower.
  ROOT CAUSE: a count copied out of the spec (§2b) and then never re-derived while the code
  grew, in a second location that nothing checks. `lib/peer-address.mjs`'s docstring had
  ALREADY been corrected for exactly this and says so in its own words — *"previously read
  'it gates exactly two operations … and nothing else', which had been false since the third
  caller landed. A comment that miscounts its own callers is worse than none"* — so the
  correction existed and this copy never received it. DO link to the source and re-derive
  with a grep. Corrected 2026-08-02.
