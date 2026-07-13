---
trdd-id: P7XKV3N9
title: Invalidate a password with the password, and gate MAESTRO rotation on console presence
column: todo
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-13T14:20:00+0200
created: 2026-07-13T14:20:00+0200
updated: 2026-07-13T14:20:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 0
severity: HIGH
effort: M
task-type: security
release-via: none
derived: false
npt: []
eht: []
blocked-by: []
relevant-rules: []
---

# TRDD-P7XKV3N9 — rotation as a product feature, and presence as the second factor

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-13

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

**NEXT ACTION:** implement `POST /api/governance/password/invalidate` (below),
then wire the forced-reset branch into the existing login/setup flow
(`/api/auth/setup-init` + `/setup-verify` already know how to accept a *new*
password — the invalidated state simply routes login back into them).

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

### 3. Remote MAESTRO is denied outright

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

## Approval log

- 2026-07-13T14:20:00+0200 — **MANDATE issued by the USER** (min-approval-requirement:
  user; the issuer IS the tier-3 authority). Pre-approved: no approval request was
  sent. Born in `design/tasks/`, per the mandate rule.
