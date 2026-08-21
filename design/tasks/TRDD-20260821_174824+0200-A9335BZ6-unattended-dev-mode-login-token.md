---
trdd-id: A9335BZ6
title: Unattended dev-mode login via an owner-minted, revocable dev token
column: dev
created: 2026-08-21T17:48:24+0200
updated: 2026-08-21T17:48:24+0200
current-owner: hub-orchestrator
created-by: hub-orchestrator
assignee: hub-orchestrator
task-type: feature
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-21T17:40:00+0200
priority: 0
severity: high
labels: [auth, dev-mode, continuity, security]
relevant-rules: []
npt: []
eht: []
---

# Unattended dev-mode login via an owner-minted, revocable dev token

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21

**The owner's directive (2026-08-21, verbatim intent):** development must continue in their
absence. `.env.local` exists precisely so no human login is required. If dev mode cannot log in
unattended, *the authentication system is built wrong and must be fixed* — not worked around.
They specified: a signed token, generated only from the dashboard behind password **+ passkey**,
shown **once** with a copy button, never viewable again, regenerable if lost, written as
`AI_MAESTRO_DEV_MODE_TOKEN=am-…` in `.env.local`.

**Two of the owner's premises were measured and are FALSE. Neither weakens the request; one
makes it cheaper. Do not re-derive these:**

1. **There is no passkey barrier to authentication.** `POST /api/auth/login` takes
   `{ password }` alone and mints the `aim_session` cookie (`app/api/auth/login/route.ts`).
   `POST /api/auth/webauthn/authenticate` is an **alternative** login that mints the same
   cookie — not a second factor. Sudo step-up (`/api/auth/sudo-password`) is password-only too.
   Grepped `requirePasskey|passkeyRequired|webauthnRequired|secondFactor|stepUp` across
   `lib app services components` → **zero hits**. So nothing has to be "disabled in dev mode".
2. **The email one-time code was NOT replaced by the passkey.** `components/governance/
   PasswordDialog.tsx` offers BOTH, side by side, as password-**reset** methods
   (`view.kind: 'reset-code' | 'passkey-newpw'`). Removing the OTP is a separate decision the
   owner has not made; it is NOT in this card's scope.

**Therefore the real defect is exactly one thing**, and it is the one already traced on
`TRDD-SCLSRS6E`: `cmd_login()` in `scripts/aimaestro-governance.sh` hard-refused a non-TTY
stdin, and `~/.aimaestro/cli-session` had therefore never been minted — so `get_auth_args()`
fell through to `()` (no auth header at all) and every `aimaestro-*.sh` verb 401'd host-wide.

**What this card still builds, and why it is worth building even though the passkey premise was
false:** putting the **master governance password** in `.env.local` means the master credential
lives in a file. A scoped, revocable, single-purpose token is strictly better — it can be
revoked without rotating the password, and it never exposes the master secret. That value is
independent of the passkey question, so the owner's design is adopted essentially as specified.
**Shipping it lets the master password be REMOVED from `.env.local` — that is the security win.**

### ⚠ SECURITY RULING — the `AI_MAESTRO_DEV_MODE=true` env var is NOT built. Read before changing this.

The owner asked for an `AI_MAESTRO_DEV_MODE=true` env gate. **It is deliberately not
implemented**, because it is the exact pattern their own USER-ratified rule forbids
(TRDD-CC9PY337, 2026-07-17, recorded at `.claude/project/memory/env-var-security-delete-not-gate.md`):

> *"an env var that can weaken a security property is DELETED — not read, not validated, not
> documented … **A dev box is NOT a safe host** — agents run under the SAME UID as the server,
> so a prompt-injected agent appends one `export` to `~/.zshrc` and the next restart picks it
> up. 'Delete' therefore means delete in every mode (dev/prod alike), never merely a release
> gate."*

That rule's own decision procedure, step 2, gives the replacement: *"Yes, and it has a dashboard
equivalent? → **DELETE the read. The dashboard owns it.**"*

So the **enable switch lives in `governance.json`** and is toggled from Settings → Security,
exactly where the owner already put the mint flow. The env var would also have bought nothing:
without the token it does nothing, and with the token dev login is already enabled — while
adding a hatch any same-UID process can set. **A bare `process.env.AI_MAESTRO_DEV_MODE` read
would additionally trip the regression fence in `tests/unit/test-only-env.test.ts`.**

`AI_MAESTRO_DEV_MODE_TOKEN` in `.env.local` is a **credential**, not a weakening setting —
possessing it *is* the authentication, the same category as the password already sitting there.
The fence targets settings, not secrets. It is read only by the shell CLI, never by server code.

### "Signed" is satisfied by a server-minted random secret + a stored hash — no HMAC

A 256-bit random secret compared in constant time against a stored SHA-256 hash gives every
property the owner asked for (unforgeable, server-only issuance, revocable, shown once). A
stateless HMAC would be strictly worse: revocation still needs a store, so the HMAC adds a key
to protect and buys nothing.

### NEXT ACTION

Unit 1 (`lib/dev-mode-token.ts`) is the coordinator's and lands FIRST — it is the contract units
2-5 compile against. Then fan out units 2-5. Ledger:
`reports/colony/DELEGATION-A9335BZ6.md`.

### Load-bearing gotchas

- The dev-token login path must **skip `unlockSecurityConfig()`** — it has no plaintext
  password. Precedent already in the tree: `app/api/auth/webauthn/authenticate/route.ts:127`
  documents skipping it for exactly this reason.
- `governance.json` is a `SignedLedger`. Adding an OPTIONAL field keeps `version: 1` valid and
  gives revoke/regenerate a durable audit trail for free — reuse it, do not add a second store.
- Read the enable flag at **call time**, never at module load, or tests cannot flip it.
- Run every test through `bash scripts/with-node.sh` (Node v26.5.0 here vs an `engines` cap of
  `<26`; `npx vitest` alone manufactures failures).

### SUPERSEDED — do NOT carry forward

- ~~"Unattended login means sourcing `AIM_GOVERNANCE_PASSWORD` from `.env.local` in
  `cmd_login()`."~~ That was the in-flight approach before the owner's directive. It is replaced
  by the dev token. **The other half of that in-flight edit STANDS and must be kept:** the login
  request body moved from `jq -nc --arg p "$password"` (which places the secret in **jq's
  ARGV**, world-readable via `ps` — the exact leak the function's own refusal cited as its
  reason for demanding a TTY) to `printf | jq -Rnc '{password: input}' | curl --data-binary @-`.
- ~~"`aimaestro-governance.sh login` is owner-only BY DESIGN; no agent may run it; do not look
  for a workaround."~~ Recorded on `TRDD-SCLSRS6E` and in the session handoff. **Reversed by the
  owner on 2026-08-21**: unattended login is a REQUIREMENT, and a TTY-only login is the defect.

## Problem

Every `aimaestro-*.sh` verb 401s host-wide — including read-only ones — because no session
credential has ever existed. The only mint path required a human at a TTY, so the fleet's
assignment lane has been parked since 2026-08-02 waiting on owner presence that the whole
point of `.env.local` was to make unnecessary.

## Proposed fix

Five units; see `reports/colony/DELEGATION-A9335BZ6.md` for file ownership and per-unit
acceptance.

1. `lib/dev-mode-token.ts` — mint / verify / revoke / status + the dashboard-owned enable flag,
   persisted in `governance.json`. Token = `am-` + base64url(32 random bytes); only its
   SHA-256 hash is stored; comparison is constant-time.
2. `app/api/auth/dev-token/route.ts` — `POST` mints behind governance password **AND** a
   verified WebAuthn assertion, returning the plaintext exactly once; `GET` returns status
   only; `DELETE` revokes. Classified `strict` in `security-registry.json`.
3. `app/api/auth/login/route.ts` — accepts `{ devToken }` in place of `{ password }`, subject
   to the same rate limits and kill-switch, minting the same session cookie.
4. `components/settings/SecuritySection.tsx` — the panel: enable toggle, status, Generate
   (password + passkey), show-once with a copy button and the literal
   `AI_MAESTRO_DEV_MODE_TOKEN=am-…` line, Regenerate, Revoke.
5. `scripts/aimaestro-governance.sh` — non-TTY `login` reads `AI_MAESTRO_DEV_MODE_TOKEN` from
   the environment or by sourcing `.env.local`, POSTs `{ devToken }`, and writes
   `~/.aimaestro/cli-session` at 0600. Fails closed when absent.

## Verification

- Every unit's own test, green under `bash scripts/with-node.sh`.
- A neuter per security-bearing unit, each reddening exactly the test that names it.
- End-to-end: with a token in `.env.local` and no TTY, `aimaestro-governance.sh login` succeeds
  and a subsequent `aimaestro-trdd.sh search` returns 0 instead of 401.
- `tests/unit/test-only-env.test.ts` stays green (proves no new bare security-weakening env read).
- The token is never echoed, never in argv, never in a report, and never enters model context.

## Estimated risk

MED. It adds an authentication path. Mitigated by: dashboard-owned enable flag (not an env
hatch), password+passkey to mint, single active token, constant-time compare, hash-at-rest,
revocable, same rate-limit and kill-switch as the password path, and fail-closed everywhere.

## Acceptance

- [ ] `lib/dev-mode-token.ts` exports the frozen contract; `tsc --noEmit` clean
- [ ] `POST /api/auth/dev-token` refuses without BOTH a valid password and a verified passkey assertion, and a neuter dropping the passkey check reds its test
- [ ] The plaintext token is returned exactly once and is unreadable afterwards through any route
- [ ] `POST /api/auth/login { devToken }` mints a session when enabled+issued, and is refused when the flag is off, when revoked, and on a wrong token
- [ ] Settings → Security renders status, Generate (password+passkey), show-once + copy, Regenerate, Revoke, and the literal `AI_MAESTRO_DEV_MODE_TOKEN=am-…` line
- [ ] `aimaestro-governance.sh login` succeeds with NO TTY given the token, fails closed without it, and never places the secret in argv
- [ ] `aimaestro-trdd.sh search` returns 0 (not 401) after that login
- [ ] `tests/unit/test-only-env.test.ts` green — no new security-weakening env read
- [ ] The master governance password can be removed from `.env.local` (the security win this buys)

## Approval log

- 2026-08-21T17:48:24+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: the owner directed the change directly. No approval request was sent.
