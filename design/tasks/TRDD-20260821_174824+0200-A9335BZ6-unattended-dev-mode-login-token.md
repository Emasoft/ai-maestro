---
trdd-id: A9335BZ6
title: Unattended dev-mode login via an owner-minted, revocable dev token
column: human_review
created: 2026-08-21T17:48:24+0200
updated: 2026-08-22T16:50:27+0200
implementation-commits: [ddf18bf7, 2b881dcf, 0f794535, f8a6a17f, 25e8ee67, 6f6cfef3, 83a50d31, 4a760eed]
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
~~**Shipping it lets the master password be REMOVED from `.env.local` — that is the security win.**~~
**⚠ SUPERSEDED 2026-08-21 — that specific win is NOT available; see NEXT ACTION step 3.** Sudo
step-up is password-only, so the e2e/scenario suite still requires the master password and it stays
in `.env.local`. The win that IS delivered: the whole CLI layer, host-wide, stopped needing it.

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

### NEXT ACTION — none. 9/9 boxes. Awaiting the USER's `human_review → complete` call.

All three steps below are resolved, the third by measurement rather than by being done. The owner
minted the token and set `AI_MAESTRO_DEV_MODE=true`; the 19-day host-wide 401 is closed, measured
end to end through the bare commands on `PATH`, and CI is green on `main` at `4a760eed`.

This card does NOT move itself to `complete`: `human_review → complete` is a USER decision
(`aimaestro-manager-approval-defaults.md` §Z), and the one open question it leaves behind — whether
to widen sudo step-up or mint a separate test credential so the master password can eventually
leave `.env.local` — is a new card, not this one.

1. ~~Settings → Security → **Dev Mode Token** → Generate, copy the `AI_MAESTRO_DEV_MODE_TOKEN=am-…`
   line into `.env.local`.~~ **DONE by the owner.**
2. ~~Unattended login + an authenticated verb.~~ **DONE, and it exposed a defect this card could
   not see — see "THE DEPLOY GAP" below.** Measured through the BARE command names on `PATH`:
   `aimaestro-governance.sh login </dev/null` → **exit 0** ("Session stored in
   ~/.aimaestro/cli-session (0600)"), then `aimaestro-trdd.sh search` → **exit 0**, 492 TRDDs,
   162 148 bytes. The one `401` substring in that payload is inside path timestamps
   (`…_014014+0200…`, `…_120401+0200…`), not an auth error — checked, not assumed.
3. ~~**Delete `AIM_GOVERNANCE_PASSWORD` from `.env.local`.**~~ **NOT ACHIEVABLE TODAY — measured
   2026-08-21, after this card had already claimed it was merely "owner action".** Keep the
   password where it is.

   Three measurements, in the order that settles it:
   - `scripts/aimaestro-governance.sh` does **not** read the env var at all. The TTY path prompts
     interactively (`:374-385`); the unattended path is token-only and fails closed (`:401-418`).
     So the CLI, which was the whole point, no longer needs it.
   - The remaining consumer is `tests/e2e/helpers.ts:22-31`, which **throws** when it is unset —
     so the e2e and scenario suites die without it.
   - And that dependency is not incidental: `POST /api/auth/sudo-password` takes
     `{ password: string }` and nothing else (`app/api/auth/sudo-password/route.ts:55`, a zod
     schema with one field). Sudo step-up is password-only, so any scenario driving a destructive
     UI flow genuinely needs the master password.

   **The win the token actually bought is still real:** the entire CLI layer, host-wide, now
   authenticates with a scoped revocable credential instead of the master secret. What is NOT
   available is removing the secret from the box, because UI testing depends on it.

   Removing it later means one of: teaching sudo step-up to accept the dev token (which widens the
   token and partly defeats "scoped"), or minting a separate test credential. Both are new work
   and neither is this card's.

### THE DEPLOY GAP — box 202 was ticked against a copy nobody runs

Box 202 ("`login` succeeds with NO TTY given the token") was proven against a loopback stub
driving **`scripts/aimaestro-governance.sh`** — the REPO copy. The copy the owner actually
invokes, `~/.local/bin/aimaestro-governance.sh`, was the **Aug 8** build carrying **0** hits for
`AI_MAESTRO_DEV_MODE_TOKEN` against the repo's 5. So the feature was committed, tested, ticked —
and *absent from the command line anyone types*. Box 203 would have failed for a reason the card
never named, and the obvious diagnosis ("the token is wrong") would have been aimed at the owner.

Deployed at 18:43 (`cp -p`, byte-identical afterwards); the stale copy is preserved at
`builds_dev/deployed-cli-backup/aimaestro-governance.sh.20260821_184306+0200` — it matched **no**
committed blob of that path, so it was not recoverable from git and was backed up before the
overwrite rather than trusted to history.

**Then redone through the sanctioned installer** (owner directive: reinstall it properly, and
check the installer's origin and branch). `./install-agent-cli.sh` — repo ROOT, not `scripts/`,
which is why a `ls scripts/ | grep install` sweep missed it — deploys 11 CLIs + 1 helper and
performs **zero** git operations: it copies from its own checkout, so there is no origin or
branch for it to get wrong. Re-verified after: **0/11 byte-stale**, 5/5 `AI_MAESTRO_DEV_MODE_TOKEN`
hits on `PATH`, `login` exit 0, `search` exit 0 / 492 records.

**`install-agent-cli.sh --status` cannot detect this class of drift.** It printed
`Status: OK` and `[OK]` on all 12 files — including the governance CLI that was 13 days stale and
missing the feature entirely — because it tests **existence**, not content. Its manifest still
read `Installed at: 2026-08-08T15:00:19Z` while reporting OK. `cmp` against the repo is the only
honest check; `--status` is why the drift survived unnoticed.

**A separate CRITICAL hazard was found while doing this and is filed as `TRDD-0N792LL5`:**
`update-aimaestro.sh` — which `install-agent-cli.sh` itself recommends on completion — does
`git checkout main`, then `git fetch`/`git pull origin main`, where `origin` is
`23blocks-OS/ai-maestro`. It was NOT run. `aimaestro-trdd.sh` remains 16 lines drifted
(commit `2071a7d7`); refreshing it needs `install-messaging.sh`, whose blast radius is the whole
AMP layer, so it is reported rather than run unprompted.

**`~/.local/bin/aimaestro-trdd.sh` is ALSO drifted** (Aug 20 vs the repo's Aug 21). It answers
correctly today, so it is reported, not silently overwritten. `cmp`, never `grep`, is what
answers "same or not".

This is `~/.claude/rules/cli-verify-on-path.md` verbatim: verify a CLI change through the bare
command name, because a repo-relative invocation passes happily while `PATH` resolves elsewhere.

### THE GAP THIS CARD FOUND IN ITSELF — do not undo it

Neutering the enable flag (`if (!rec || rec.enabled !== true)` → `if (!rec)`) reddened **0 of 14**
tests. The flag is the ENTIRE security justification for refusing to build `AI_MAESTRO_DEV_MODE`,
so with nothing pinning it that refusal was decorative — a disabled host would have honoured a
token anyway. Root cause was structural and the coordinator's: unit 1 was self-assigned with only
`tsc --noEmit` as acceptance, so the crypto core shipped with no suite while all four DELEGATED
units got one. `tests/unit/dev-mode-token.test.ts` (`0f794535`) closes it; the same neuter now
reds exactly 1 of 23. **A brief that omits a check produces a report that cannot mention it.**

### Neuter runs — all OBSERVED by the coordinator via `scripts/dev/neuter`, restores blob-verified

```
lib/dev-mode-token.ts       enable flag ignored      → 0 red / 14  ← THE GAP (before the fix)
lib/dev-mode-token.ts       enable flag ignored      → 1 red / 23  ← after
app/api/auth/login/route.ts accept ANY devToken      → 1 red / 5   "a wrong dev token 401s"
app/api/auth/dev-token/…    passkey check no-op      → 1 red / 9   "refuses when the assertion
                                                                    verification fails"
```

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

- [x] `lib/dev-mode-token.ts` exports the frozen contract; `tsc --noEmit` clean
- [x] `POST /api/auth/dev-token` refuses without BOTH a valid password and a verified passkey assertion, and a neuter dropping the passkey check reds its test — 9/9 green, neuter 1 red
- [x] The plaintext token is returned exactly once and is unreadable afterwards through any route — asserted on the status object's exact key set, so a future field cannot leak one silently
- [x] `POST /api/auth/login { devToken }` mints a session when enabled+issued, and is refused when the flag is off, when revoked, and on a wrong token — 5/5 + 9/9 green; neuters 1 red each
      **RE-VERIFIED 2026-08-22T16:50 by an independent hub pass, because a prior session recorded
      this exact gate as UNPINNED.** `~/.claude/rules/lessons-verification.md` carried *"the one
      unit with no suite was `lib/dev-mode-token.ts`, and neutering its enable flag reddened 0 of
      14 — so the refusal was decorative and a disabled host would have honoured a token anyway."*
      **That is now false and the correction is dated in place.** Re-run through
      `scripts/dev/neuter` (1 ins / 1 del, restore verified by blob hash):
      `s/if \(!rec \|\| rec\.enabled !== true\) return false/if (!rec) return false/` over all four
      dev-token suites → **2 red / 23 green**:
      *"refuses a correct token while disabled, and honours it again when re-enabled"* and
      *"mints a session from AI_MAESTRO_DEV_MODE_TOKEN, writes it 0600, and never puts the token in
      a child process argv"*. **The gate is pinned; the security argument this card rests on is
      load-bearing rather than decorative.**
- [x] Settings → Security renders status, Generate (password+passkey), show-once + copy, Regenerate, Revoke, and the literal `AI_MAESTRO_DEV_MODE_TOKEN=am-…` line — built from the lib's exported const, so the UI and CLI cannot drift; 0 hits for localStorage/sessionStorage/logging
- [x] `aimaestro-governance.sh login` succeeds with NO TTY given the token, fails closed without it, and never places the secret in argv — proven against a loopback stub with a curl shim that RECORDS argv, plus a delta-0 count of the real `~/.aimaestro` to prove containment
- [x] `aimaestro-trdd.sh search` returns 0 (not 401) after that login — measured through the BARE command on `PATH`: login exit 0, search exit 0, 492 TRDDs / 162 148 bytes; the lone `401` substring is a path timestamp, verified in context. Required deploying the repo script over the Aug-8 copy on `PATH` first (see "THE DEPLOY GAP")
- [x] `tests/unit/test-only-env.test.ts` green — no new security-weakening env read
- [x] The master governance password can be removed from `.env.local` (the security win this buys) — **RESOLVED AS NOT ACHIEVABLE, and that is the finding.** `POST /api/auth/sudo-password` accepts `{ password: string }` only (one-field zod schema), so sudo step-up is password-only and `tests/e2e/helpers.ts:22-31` throws without it — deleting the password breaks every scenario that drives a destructive UI flow. The CLI itself no longer reads the env var (`aimaestro-governance.sh:374-418`), which is the win that WAS available. Box closed on the measurement, not on the outcome it hoped for; widening sudo or minting a test credential is separate work

## Approval log

- 2026-08-21T17:48:24+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: the owner directed the change directly. No approval request was sent.
