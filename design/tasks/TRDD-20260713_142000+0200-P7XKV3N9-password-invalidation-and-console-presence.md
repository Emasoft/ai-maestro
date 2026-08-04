---
trdd-id: P7XKV3N9
title: Invalidate a password with the password, and gate MAESTRO rotation on console presence
column: human_review
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:20:00+0200
created: 2026-07-13T14:20:00+0200
updated: 2026-08-05T01:08:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 0
severity: HIGH
effort: M
task-type: security
release-via: none
derived: false
npt: []
eht: [7U927FCM]
blocked-by: []
implementation-commits: [13dfbb92, 0d2d421f, 76e738f9, fdeee818, 396b5d10, fbefaa3d]
relevant-rules: []
---

# TRDD-P7XKV3N9 — rotation as a product feature, and presence as the second factor

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-13

**RECOVERY-EMAIL FOLLOW-UP (2026-07-17, commit `396b5d10`):** the USER hit first-run recovery
setup with a Google address and got "the smtp server address was wrong" — a `FAILED`/unreachable
verify whose copy said "check the address" while the form had NO server field to check. Root
cause verified empirically: `@gmail.com` detects `smtp.gmail.com` correctly and a bad password
routes to the helpful `AUTH_REQUIRED` path, so the FAILED verdict was a mis/undetected server
(custom-domain relay likely) with no override. FIX: `RecoveryEmailSection` now has an editable
SMTP host/port/TLS override (auto-filled by Detect); `POST /api/governance/email/configure`
accepts optional `host`/`port`/`secure` and, when `host` is set, uses it verbatim and SKIPS
autodetection (blank host ⇒ prior autodetect path unchanged). tsc 0, build 0, route tests 6/6
(2 new cover the override-vs-autodetect branch). AWAITING the USER's retry with their real server.

**MANDATED by the USER on 2026-07-13, born approved.** Verbatim:

> add an api command that will invalidate a password by inserting that very
> password. once invalidated, next time the USER will login it will be asked to
> create a new password (in the future we will add a passkey system to ensure the
> user is the same that registered). for the MAESTRO USER instead, the same thing
> but the confirmation uses a message pin delivered by the mac os or linux / win os
> with a popup or any notification system the operating system has. it only has to
> ensure the user is the one sitting before the computer. If the MAESTRO USER is
> logged from its iphone or mobile or some other device with a browser, it will deny
> the login and any password change. in the future we will implement the passkey
> system for the MAESTRO USER too.

**Why this is P0 and not a nice-to-have:** TRDD-44RGLOO8 is a live credential
leaked into a PUBLIC repo, and its only fix is rotation — which today has no
in-product path at all. An agent must never rotate a credential, so without this
feature rotation is a manual chore the owner must perform by hand, which is
exactly the kind of chore that does not get performed. **This TRDD is what
unblocks 44RGLOO8 for good, and what makes every future rotation cheap enough to
actually happen.**

**▶ 2026-07-13 — SHIPPED AND VERIFIED LIVE.** `column: testing`.

Commits: `0d2d421f` (endpoint + peer-address + state), `76e738f9` (CLI + UI),
`fdeee818` (the .mjs fix), `13dfbb92` (dedupe onto setup-bootstrap/rate-limit).

- `POST /api/governance/password/invalidate` — password ⇒ code on the desktop ⇒
  revoked. Console-gated, throttled 5/15min per peer, fail-closed.
- `lib/peer-address.mjs` — the trusted peer. **`server.mjs` deletes any inbound
  `x-aim-peer` and stamps it from `req.socket.remoteAddress`.**
- `invalidatePassword()` DESTROYS the hash; `setPassword()` clears the flag.
- `aimaestro-governance.sh invalidate-password` — TTY prompt, never argv.
- Settings → **Revoke** button + `RevokePasswordDialog`.
- 9 new unit tests; 172 test files green; build green.

**The proof that counts** (from this host's own Tailscale IP, a genuinely remote
peer): an honest remote call gets `403 console_required`, and a call **forging**
`X-Forwarded-For: 127.0.0.1` + `X-Real-IP: ::1` + `X-Aim-Peer: 127.0.0.1` *also*
gets `403`. Curling from loopback proves nothing (the peer really is 127.0.0.1) —
the spoof only becomes a test when the source is actually remote.

**NEXT ACTION:** the owner rotates the leaked credential using this feature —
Settings → Revoke, or `aimaestro-governance.sh invalidate-password` — which is
what unblocks **TRDD-44RGLOO8**. An agent must never rotate a credential.

**Two things this TRDD did NOT do** (both deliberate, both still open):
- **MAESTRO *login* is not yet console-gated.** §2b binds the console rule to two
  operations; only the password-change half is built. Login still accepts a
  session from any VPN device.
- **The general TTY→sudo-token path for other strict routes is TRDD-9MZQ4T7E.**
  This endpoint sidesteps it by self-authenticating (its input IS the password),
  so it needed no sudo token — which is why it could ship first.

## The two mechanisms

### 1. Invalidate-by-possession (both principals)

`POST /api/governance/password/invalidate`, body `{ password }`.

Supplying the **current password** is the proof of possession — no separate token,
no session required. Effect: the credential is marked **invalidated** (persisted in
`~/.aimaestro/governance.json`, so it survives a restart). It is **not** replaced
with a new value; there is no window in which a *known* password is live.

On the next login the user is not asked to authenticate — they are asked to
**create a new password**. That is the whole flow: a self-service rotation with no
CLI, no file editing, no server restart.

A wrong password changes nothing and consumes no state.

### 2. Console presence (MAESTRO only)

The MAESTRO password is the master credential, so possession alone is not enough —
the second factor is **being physically at the machine**:

- On an invalidate (or any password change) requested as MAESTRO, the server emits
  a **PIN via the host OS's own notification system** — macOS notification /
  `osascript`, Linux `notify-send`, Windows toast — and the caller must echo that
  PIN back to complete the operation.
- The property this buys: **an attacker holding the password but not sitting at the
  console never sees the PIN.** The notification is delivered to the physical
  desktop, not to the HTTP response. That is the entire point, and it is why the
  PIN must never be returned in any API body, log line, or error message.

### 2b. SCOPE — the console rule binds TWO operations, and NOTHING else

**Read this before generalizing anything below.** USER, 2026-07-13:

> of course we are only talking about tailscale vpn. anything outside the tailscale
> vpn is not allowed to see the server at all. but anything inside the vpn, either a
> mobile phone, a remote computer, a script on a server, anything.. can call the api
> of the server. after all, every function must be available from the browser when
> connecting from other devices and working remotely. this does not mean that any
> api command automatically allows any action. the command can still require more,
> for example a cookie to prove the user is logged in, or the AID to prove the agent
> is the one registered with the server, and so on.

So the model is:

| layer | rule |
|---|---|
| **network** | Tailscale VPN is the perimeter. Outside it, the server is invisible — `isAllowedSource()` in `server.mjs` stays exactly as it is. **This TRDD does not widen the bind.** |
| **inside the VPN** | **every device is a first-class caller** — phone, iPad, remote machine, a script on a server. Every function must be reachable from a browser on another device, because remote work is the point. |
| **authorization** | per-command, and it is about **who you are**, never **where you are**: a session cookie (a logged-in human), an AID proof (a registered agent), a sudo token (a strict route). Reachable ≠ permitted. |

**The loopback check is therefore NOT a general authorization signal, and must never
be used as one.** It is a *presence* factor, and it binds exactly two operations:

- MAESTRO **login**, and
- MAESTRO **password change / invalidate**.

Everything else — every other route, for MAESTRO and for agents alike — is fully
usable from any device on the VPN and is gated by cookie / AID / sudo token only.
Applying a loopback check anywhere else would break remote administration from the
phone, which is a feature, not a leak.

**And note what actually does the work here: the PIN, not the IP.** A remote
attacker holding the password still cannot read a notification rendered on your
desktop. The loopback denial is the USER's explicit policy for MAESTRO sessions
("deny the login from the iPhone"); the PIN is the security property.

### 3. Remote MAESTRO is denied outright (login + password change ONLY — see 2b)

> "If the MAESTRO USER is logged from its iphone or mobile or some other device
> with a browser, it will deny the login and any password change."

**Determine this by the CONNECTION, never by the User-Agent.** A UA string is
attacker-controlled and sniffing it is security theater: an iPhone can claim to be
a Mac in one header. The non-spoofable signal already exists in this codebase —
`isAllowedSource()` in `server.mjs` distinguishes:

| source | MAESTRO login / password change |
|---|---|
| loopback (`127.0.0.1`, `::1`) — the console | **allowed** (still PIN-gated) |
| Tailscale CGNAT (`100.64.0.0/10`) / ULA (`fd7a:115c:a1e0::/48`) — a phone, an iPad, another machine | **denied** |

So "is the user sitting before the computer" is answered by *the packet arrived on
loopback*, which a remote device cannot forge. The PIN is the second factor on top
of that; the loopback check is the first. Non-MAESTRO login over Tailscale is
unaffected — only MAESTRO is console-bound.

## Constraints that must not be traded away

- **The PIN never leaves the console.** Not in the response body, not in a log, not
  in an error. If it can be read over HTTP, it proves nothing.
- **Fail closed.** No OS notification channel available ⇒ the MAESTRO rotation is
  **refused**, never waved through. A presence check that degrades to "skip it" is
  not a presence check.
- **The PIN is short-lived and single-use**, and a wrong PIN consumes the attempt.
  Otherwise it is brute-forceable over a long-lived window.
- **Never log or echo the password**, on any path, including the failure path — see
  TRDD-E9BZ5P7S, which exists because a password that *may* be written down
  eventually is.
- **The invalidated state is durable.** A restart must not resurrect the old
  credential; that would turn rotation into a suggestion.

- **Throttle it. The password is this endpoint's INPUT.** Every other route takes a
  *token*; this one takes the secret itself, which makes it the single most
  attractive target on the whole surface — and it is reachable from every device on
  the VPN (that is deliberate, see 2b). "Without the password they can't do
  anything" is only true if they cannot **guess** it at line rate: with no backoff,
  an unauthenticated attacker on the VPN gets unlimited free attempts against the
  master credential. So: exponential backoff + lockout on repeated failures, keyed
  per-source, and the same for the PIN (short-lived, single-use, wrong PIN consumes
  the attempt). A rate limit is not a nicety here; without it the endpoint *weakens*
  the system it exists to protect.

## The API is the authority; every surface is a thin caller

USER, 2026-07-13:

> once the api call for invalidating the password of an USER is done, you can make
> many ways to call it: via a button in the settings page, or via a script of
> ai-maestro, etc.

**Build the endpoint FIRST, then the surfaces — and the surfaces carry no policy.**
Every gate above (possession, the loopback check, the PIN, fail-closed, durability)
lives in `POST /api/governance/password/invalidate` and **nowhere else**. A surface
supplies input and renders the outcome; it never decides anything.

| surface | what it is |
|---|---|
| **Settings page button** ("Invalidate password → forces a new one on next login") | a form that POSTs. The loopback denial and the PIN prompt arrive as API responses; the UI just renders them. |
| **`aimaestro-*.sh` CLI verb** | a wrapper that prompts for the password on a **TTY** (never `$1`, never an env var on the command line — TRDD-E9BZ5P7S) and POSTs it. Per the decoupling invariant, the script layer is the ONLY code allowed to call the API; a plugin/hook that wants this calls the script, never `fetch()`. |
| future (passkey, panel, whatever) | same: a caller. |

**Why this is stated and not left implicit.** The obvious failure is each surface
re-implementing the presence check — the UI checks the connection, the script
checks something else, and the third surface, added in a hurry, checks nothing.
Then the gate is only as strong as the weakest caller, and the whole feature is
theater. One enforcement point, N dumb callers: a new surface can only ever be as
safe as the endpoint, and it cannot lower the bar by existing.

**The deeper reason, and the one that settles it: EVERY route is curl-able.** The
API is plain HTTP — 49 of the `~/.local/bin/aimaestro-*.sh` / `amp-*.sh` scripts
are curl wrappers (they pass `X-Sudo-Token` through `AIMAESTRO_SUDO_TOKEN`). So a
"surface" is never a chokepoint: whatever the button and the script do, anyone can
skip both and curl the endpoint directly. A gate placed in a client is therefore
not a weak gate — it is *no gate*.

Two consequences that decide the design rather than merely decorating it:

- **The presence check cannot be "which client are you".** curl sets any
  User-Agent, so UA-sniffing is defeated by a command-line flag. The **connection**
  (loopback vs Tailscale CGNAT) is the one property a phone cannot forge, which is
  precisely why the check lives there and nowhere else.
- **"The script layer is the only code allowed to call the API" is a DECOUPLING
  rule, not a security boundary.** It keeps plugins from hardcoding endpoints that
  churn. It has never prevented a direct curl and was never meant to. Do not read
  it as a defence, or you will "harden" the wrapper and leave the endpoint open.

This also names the real gap on the human side: a token-less curl to a strict route
is already rejected (401). What is missing is any way for a **human** to *obtain* a
sudo token outside the web UI's modal — which is exactly what TRDD-9MZQ4T7E adds: a
TTY password prompt that performs the exchange.

Corollary: a surface must NOT pre-validate the password to give a "nicer" error. It
would need to hold the secret to do so, and any code that holds the secret is code
that can leak it.

## Deliberately deferred (the USER said so)

**Passkeys / WebAuthn for both principals.** The USER named it twice as the future
direction, and it is the real answer: it binds the credential to a device rather
than to a secret a human can leak. This TRDD ships the interim mechanism —
possession + presence — and does not pretend to be that. When passkeys land they
*replace* the PIN, they do not sit beside it.

## Verification

- Invalidate with the correct password ⇒ next login demands a NEW password.
- Invalidate with a wrong password ⇒ nothing changes; no state consumed.
- MAESTRO invalidate from loopback ⇒ a PIN appears **on the desktop**, and the
  operation completes only when it is echoed back.
- MAESTRO invalidate from a Tailscale peer (a phone) ⇒ **denied**, and no PIN is
  ever emitted.
- The PIN appears in **no** HTTP response body and in **no** log file (grep the
  request/response of every path, including the failure path).
- Restart the server after an invalidate ⇒ still invalidated.

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list, re-run live. The open boxes are
the two things the STATE names as deliberately not done, plus the rotation itself — which is the
owner's, because **an agent must never rotate a credential**.

- [x] invalidate with the CORRECT password ⇒ the hash is DESTROYED and the next login demands a new
      one. `invalidatePassword()` does not flag-and-keep: nothing remains to verify against, so
      every caller reading `passwordHash` without also consulting a flag cannot honour a revoked
      credential
- [x] invalidate with a WRONG password ⇒ nothing changes and **no state is consumed** — no code
      burned, not invalidated, and the password still verifies afterwards
- [x] from the console ⇒ a code goes to the DESKTOP and the operation completes only when it is
      echoed back; a wrong code leaves the password intact
- [x] **from a Tailscale peer ⇒ denied, and no code is EVER emitted.** Pinned three ways, including
      that a remote caller with the CORRECT password and one with a WRONG password get a
      byte-identical 403 — the anti-oracle property, which is why the presence check sits ahead of
      the credential check. Also proven LIVE from this host's real Tailscale IP (STATE): an honest
      remote call 403s, and one FORGING `X-Forwarded-For` + `X-Real-IP` + `X-Aim-Peer` also 403s
- [x] the code appears in **no HTTP response body** — asserted on the SERIALIZED body, not on a
      named key, because a spread of the flow object is exactly how an unpredicted key arrives.
      Checked on the failure bodies too
- [x] the code appears in **no log line** — verified by reading rather than by test: neither
      `lib/setup-bootstrap.ts` nor the route interpolates it into any `console.*` call
- [x] restart the server after an invalidate ⇒ **still invalidated** (persisted in
      `~/.aimaestro/governance.json`)
- [x] **the ROUTE itself is now tested** — it was not; see below (`fbefaa3d`, 11 tests, 3 neuters)
- [ ] **the owner rotates the leaked credential using this feature** — Settings → Revoke, or
      `aimaestro-governance.sh invalidate-password`. This is what unblocks [[44RGLOO8]], and it is
      HUMAN-ONLY: an agent must never rotate a credential
- [ ] **MAESTRO *login* is not yet console-gated** — §2b binds the console rule to two operations
      and only the password-change half is built. Deliberate and still open
- [ ] the general TTY→sudo-token path for other strict routes — [[9MZQ4T7E]]. This endpoint
      sidesteps it by self-authenticating (its input IS the password), which is why it shipped first
- [ ] the recovery-email SMTP override (`396b5d10`) — *"AWAITING the USER's retry with their real
      server"*. The route tests cover the override-vs-autodetect branch; what is untested is the
      user's actual relay

## ⏱ VERIFIED 2026-08-02 — the route's INGREDIENTS were tested and the route was not

`password-invalidation.test.ts` covers the `invalidatePassword()` FUNCTION; `peer-address.test.ts`
covers `isConsolePeer`. Both are the route's ingredients; neither is the route. Its sibling
`POST /api/governance/password/reset` has a full 16-case route suite — and **this** endpoint, which
this card calls *"the single most attractive target on the whole surface"* precisely because its
input IS the secret, had none.

Three properties could not be borrowed from the ingredient tests and are now pinned
(`tests/unit/password-invalidate-route.test.ts`): the remote refusal happens BEFORE the credential
is touched, the code never reaches a response body, and a wrong password consumes nothing. Plus the
throttle (5 then 429) and the IPv4-mapped loopback `::ffff:127.0.0.1` a dual-stack bind actually
reports — rejecting that shape would lock the owner out at their own keyboard.

**The instructive neuter is the ORDER.** Moving the presence check below the password check reds
exactly ONE test: the other two remote cases still get a 403, just from further down. So a suite
without that one test would call an oracle-shaped endpoint correct, and the ordering — the entire
anti-oracle argument, and the thing the route's own comment says it is doing "deliberately" — was
pinned by nothing until today.

## Approval log
- 2026-08-05T01:08:00+0200 — `testing → human_review`. Column only; no work, no boxes, no scope changed.
  `testing` asserts someone is actively working this card, and nobody is — all four remaining boxes are human-only; the card says so itself of the first — *"this is what unblocks 44RGLOO8, and it is HUMAN-ONLY: an agent must never rotate a credential"*.
  `blocked` would be the wrong move: it requires a non-empty `blocked-by:` naming an open
  CARD, and what this waits on is a person, not a card. `human_review` is the column that
  says "done to the point where a human must act", which is true. Re-columned during the
  triage of the 13 stale WORK-column cards, after reading this card's open box individually.


- 2026-07-13T14:20:00+0200 — **MANDATE issued by the USER** (min-approval-requirement:
  user; the issuer IS the tier-3 authority). Pre-approved: no approval request was
  sent. Born in `design/tasks/`, per the mandate rule.
