---
spec: credentials-and-auth
spec-version: 1.0.0
status: draft
created: 2026-10-07T08:26:27+0200
updated: 2026-10-07T08:26:27+0200
maintainer: ai-maestro
project-id: ai-maestro
authority: "DESCRIPTIVE record of what the CODE does, derived from the code at the commit named in `derived-at` with `file:line` citations. Where a code comment and the enforced predicate disagree, the PREDICATE is recorded as the behaviour and the disagreement is listed in the CRED-GAP family. Code beats this prose on any disagreement; a line number that has drifted is a defect of this document, not of the code."
derived-at: "31060a754 (branch governance-rules) — every file:line below was read at that commit"
implementations:
  - "lib/agent-auth.ts — authenticateAgent / authenticateFromRequest / authenticateFromRequestAsync / buildAuthContext"
  - "lib/aid-token.ts, lib/aid-nonce.ts, app/api/v1/auth/token/route.ts, app/api/v1/auth/challenge/route.ts — aim_tk_ governance tokens"
  - "lib/session-secret.ts, lib/session-env.ts — mst_ session secrets (the AID_AUTH environment variable)"
  - "lib/session-auth.ts, app/api/auth/login/route.ts — aim_session browser cookie"
  - "lib/dev-mode-token.ts, lib/dev-mode-token-constants.ts, app/api/auth/dev-token/route.ts — am- dev-mode login token"
  - "lib/governance.ts, lib/argon2.ts — the governance password"
  - "lib/sudo-auth.ts, lib/sudo-guard.ts, app/api/auth/sudo-password/route.ts — sudo tokens and the strict-route guard"
  - "lib/amp-auth.ts, lib/amp-keys.ts, services/amp-service.ts, app/api/v1/register/route.ts — AMP API keys and Ed25519 keypairs"
  - "lib/portfolio-*.ts, lib/trdd-approval-token.ts, app/api/agents/[id]/portfolio/route.ts, app/api/trdd/[id]/{approve,promote,verify}/route.ts — portfolio, approval and verdict tokens"
  - "middleware.ts, services/headless-router.ts — the structural credential gate"
---

# Credentials and authentication — how each credential authenticates a caller

Written because no spec in `design/specs/` covered authentication, and the contract was being re-derived from CODE COMMENTS, which describe the line they sit on and nothing more (TRDD-LS1UNUP1: two false premises, one of which parked real work for 20 days). Every statement here is derived from code and carries a `file:line`. Comments are corroboration only. Anything this document could NOT verify in code is in the CRED-UNV family and is marked UNVERIFIED; it is not asserted anywhere else.

## CRED-GREP — how to grep this spec

```text
CRED-GREP  one family:            grep 'CRED-SUD-'
           every gap:             grep 'CRED-GAP-'
           every unverified item: grep 'UNVERIFIED'
           a class by prefix:     grep -n 'aim_tk_\|mst_\|amp_live_sk_\|aim_session\|am-' design/specs/credentials-and-auth-spec.md
```

Families: GEN (inventory and combination) · PWD (governance password) · SES (browser session cookie) · DEV (dev-mode login token) · SUD (sudo token and the strict-route guard) · AID (aim_tk_ governance token) · MST (mst_ session secret) · AMP (AMP key and Ed25519 keypair) · PRT (portfolio, approval and verdict tokens) · HDL (headless router) · GAP (comment versus predicate) · UNV (unverified).

## Section 1 — Inventory and combination (CRED-GEN)

`CRED-GEN-01` **the classes** — the code distinguishes these credential classes. "Wire shape" is what the caller presents; "store" is where the server keeps what it validates against.

| Class | Wire shape | Presented as | Store | Spec family |
|---|---|---|---|---|
| governance password | free text, 1-256 chars at the login and sudo schemas | JSON body field `password` | argon2id (or legacy bcrypt) hash in `governance.json` | CRED-PWD |
| browser session | 64 hex chars (32 random bytes), no prefix | cookie `aim_session` | in-memory Map of SHA-256 hashes | CRED-SES |
| dev-mode login token | `am-` plus base64url of 32 random bytes | JSON body field `devToken` to the login route only | SHA-256 hex in `governance.json` field `devModeLogin` | CRED-DEV |
| sudo token | base64url of 32 random bytes, no prefix | header `X-Sudo-Token` | in-memory Map of SHA-256 hashes | CRED-SUD |
| AID governance token | `aim_tk_` plus 64 hex chars | `Authorization: Bearer` | JSON file of SHA-256 hashes | CRED-AID |
| session secret | `mst_` plus 64 hex chars | `Authorization: Bearer`; held by the agent as `$AID_AUTH` | SHA-256 hash in the agent's registry metadata | CRED-MST |
| AMP API key | `amp_live_sk_` or `amp_test_sk_` plus 64 hex chars | `Authorization: Bearer` | JSON file of SHA-256 hashes | CRED-AMP |
| portfolio / approval / verdict token | UUID token id, host-signed record | never presented as a bearer; looked up server-side by agent id or by the id in a TRDD frontmatter field | per-subject JSON file plus the host-signed portfolio ledger | CRED-PRT |
| compact IBCT | JWT starting `eyJ` | `Authorization: Bearer`, async auth path only | not specified here (CRED-UNV-05) | CRED-GEN-05 |

Prefix and size constants: `aim_tk_` at `lib/aid-token.ts:76`, 32 random bytes at `:77`; `mst_` at `lib/session-secret.ts:27`, 32 bytes at `:28`; `amp_live_sk_` and `amp_test_sk_` at `lib/amp-auth.ts:23-24`, 32 bytes at `:25`; the dev-token prefix `am-` and env name `AI_MAESTRO_DEV_MODE_TOKEN` at `lib/dev-mode-token-constants.ts:24,27`; the session cookie name at `lib/session-auth.ts:32`, 32 bytes at `:33`.

`CRED-GEN-02` **the order in which a request is classified** — `authenticateAgent(authHeader, agentIdHeader, cookieHeader)` (`lib/agent-auth.ts:66`) decides in this order and the first match wins:

1. No `Authorization` and no `X-Agent-Id` (`:72`): try the `aim_session` cookie (`:80-96`). A valid session returns `{ userId, userTitle }` when the user-authority model is on and the session resolves a user (`:89-92`), otherwise `{}` (`:94`). `{}` is the "web-UI owner" shape: no agent id, no title.
2. Still unauthenticated at that point: if no governance password hash exists the error is `first_run_required` with status 401 (`:100-108`); otherwise a generic 401 (`:110-113`).
3. `X-Agent-Id` without `Authorization` is refused 401 (`:117-122`).
4. A bearer token has its `Bearer ` prefix stripped (`:126-128`; a raw header value with no prefix is accepted as the token) and is classified by prefix: `aim_tk_` (`:131`), then `mst_` (`:201`), then everything else goes to the AMP key path (`:235`).
5. `authenticateAgent` ends in a thrown error, not a grant, for any unreachable path (`:264-265`).

`CRED-GEN-03` **what each branch returns** — the `AgentAuthResult` shape is at `lib/agent-auth.ts:33-56`.

| Branch | Result fields set | Title and team come from |
|---|---|---|
| session cookie, model off | none (`{}`) | not applicable |
| session cookie, model on | `userId`, `userTitle` | `user-registry` via `resolveUserTitle` (`:564-576`) |
| `aim_tk_`, subject `user` | `userId`, `userTitle` (default `'user'`) | the token record (`:161-164`) |
| `aim_tk_`, subject `agent` | `agentId`, `governanceTitle`, `teamId` | the TOKEN RECORD, frozen at mint (`:191-195`); the token's `scope` is not carried into the result (CRED-GAP-09) |
| `mst_` | `agentId`, `governanceTitle`, `teamId` | the CURRENT registry and team state via `resolveGovernanceContext` (`:226-231`, `:538-555`) |
| `amp_live_sk_` / `amp_test_sk_` | `agentId` only (`:261`) | not set: no title and no team |
| compact IBCT (async path) | `agentId`, `governanceTitle`, `teamId`, `ibctScope`, `ibctMaxDepth` | registry (`:326-333`) |

`CRED-GEN-04` **checks every agent-bearing branch applies** — (line numbers in this clause are `lib/agent-auth.ts`) before returning, the `aim_tk_`, `mst_`, AMP key and IBCT branches each: (a) require a presented `X-Agent-Id` to equal the authenticated id, else 403 (`:168-173`, `:210-215`, `:245-250`; the IBCT branch does not read `X-Agent-Id`); (b) refuse a soft-deleted holder with 401 (`isSoftDeletedAgent`, `:522-532`, applied at `:176`, `:254`, `:314`; the `mst_` branch gets the same effect because `findAgentBySessionSecret` skips rows with `deletedAt`, `:491`); (c) apply the R34.1 ledger-association gate, which returns true unconditionally unless `loadSecurityConfig().ledger.enforceAidAssociation` is on (`:593-615`, default `false` at `lib/security-config.ts:96`). An unreadable registry fails closed for (b) (`:529-530`).

`CRED-GEN-05` **IBCT** — `authenticateFromRequestAsync` (`:291`) intercepts bearers starting `eyJ` (`:301`), verifies them with `verifyCompactIbct` (`:303`), requires an issuer starting `aip:key:ed25519:` (`:305`), and falls through to the synchronous path for every other token (`:340`). The IBCT token's internals are outside the scope of this spec (CRED-UNV-05).

`CRED-GEN-06` **owner, from an auth result** — `buildAuthContext` (`:401-439`) computes `isSystemOwner`:

- an errored auth result is never the owner (`:417-418`);
- model OFF (the shipped default, `types/governance.ts:139`): `isSystemOwner = !agentId` (`:425-428`), so every authenticated NON-AGENT caller is the owner: a session cookie, and also a user-subject `aim_tk_` token;
- model ON: `isSystemOwner = !agentId && userTitle is maestro or maestro-delegate` (`:419-424`).

An unreadable model flag reads as OFF (`lib/governance.ts:538-548`). `buildSystemAuthContext(reason)` (`:459-474`) mints an owner context with `governanceTitle: 'system'` for in-process callers and requires a non-empty `reason`.

`CRED-GEN-07` **the structural gate in front of every route** — `middleware.ts` rejects any `/api/*` request outside its whitelist (`:34-93`) that carries no cookie matching `aim_session=[A-Za-z0-9_+/=-]+` (`:112`) and no bearer matching `^Bearer\s+(aim_tk_|amp_live_sk_|mst_|eyJ)[A-Za-z0-9_\-.]{10,}$` (`:117`); it cannot verify anything (Edge runtime, `:16-22`). `/api/v1/route` additionally accepts a non-empty `X-Forwarded-From` as a credential shape (`:131-136`). The `amp_test_sk_` prefix is NOT in the bearer regex, so a test-prefix key is rejected at the gate even though `isValidApiKeyFormat` accepts it (`lib/amp-auth.ts:154-158`). The `am-` dev token and the sudo token are not bearer shapes and never pass this gate; the dev token is presented only to the whitelisted login route.

`CRED-GEN-08` **per-route verification entry points** — `lib/route-auth.ts`: `requireAuth` (`:82`), `requireAuthAsync` (`:110`), `enforceAuth` (`:139`), `enforceSystemOwner` (`:161-182`, 403 `Forbidden — system owner only` when `!ctx.isSystemOwner`), `enforceMaestro` (`:197`, an alias of `enforceSystemOwner`), `requireUser` (`:224-250`, refuses any caller with an `agentId`). All of them go through `authenticateFromRequest` except `requireAuthAsync`, which uses `authenticateFromRequestAsync` and is the only one that accepts IBCT. Mutating methods are refused with 503 while the kill switch is active or the ledger is in read-only mode (`checkWriteBlock`, `:42-62`).

## Section 2 — The governance password (CRED-PWD)

`CRED-PWD-01` **what it is and where it lives** — one password per host in `governance.json` (`lib/governance.ts:23`, field `passwordHash`, `types/governance.ts:49`). Hashing is argon2id with parameters read from the security config, clamped to floors and ceilings (`lib/argon2.ts:21-23`, `:35-46`); the legacy bcrypt digest is still accepted (`verifyPasswordAuto`, `:66-75`). `governance.json` is written by `writeFileSync(tmp, json, 'utf-8')` with no `mode` option (`lib/governance.ts:183-184`), unlike the AID token store which passes `0o600` (`lib/aid-token.ts:167`); the resulting mode is whatever the process umask gives (UNVERIFIED on a live host, CRED-UNV-04).

`CRED-PWD-02` **set, verify, invalidate** — `setPassword` (`:197-212`) re-hashes, stamps `passwordSetAt`, clears `passwordInvalidatedAt`, and re-encrypts the security config if unlocked. `verifyPassword` (`:334-351`) is a MUTATION when the stored hash is outdated: a successful match against an old bcrypt digest or low-cost argon2 rewrites `governance.json`. `invalidatePassword` (`:227-235`) destroys the hash (`passwordHash = null`) rather than flagging it.

`CRED-PWD-03` **what the password authorizes** — it is an INPUT credential, never a bearer. It is accepted at: `POST /api/auth/login` (`app/api/auth/login/route.ts:71-73`, mints a session cookie, CRED-SES-02); `POST /api/auth/sudo-password` (mints a sudo token, CRED-SUD-02); `POST /api/auth/dev-token` (a required factor for minting the dev token, CRED-DEV-02); and the other routes that call `verifyPassword`. Login additionally unlocks the encrypted security config with the plaintext (`login/route.ts:96-99`); the dev-token and WebAuthn login branches do not, and rely on the config's default-key fallback (`:92-95` comment, `:96` predicate).

`CRED-PWD-04` **brute-force controls on the three password-accepting routes** — login: a per-source bucket keyed by `x-forwarded-for` or `x-real-ip` or `'unknown'` (`login/route.ts:49-59`) plus a global cap of 200 (`:63`); per-source bucket reset on success only (`:89`); kill-switch lockdown refuses with 503 (`:37-42`) and each failed attempt calls `recordAuthFailure` (`:78`). Sudo and dev-token routes: global 200 plus a per-caller bucket of 5 reset on success only (`sudo-password/route.ts:45-46,129-136,183`; `dev-token/route.ts:40-42,105-116,171`).

## Section 3 — The browser session cookie (CRED-SES)

`CRED-SES-01` **shape, store, lifetime** — `aim_session=<64 hex>` (`lib/session-auth.ts:113`); the server stores `{ token_hash (SHA-256 hex), created_at, expires_at, ip? }` in a `Map` hung on `globalThis` (`:21-26`, `:55-57`). The store is in memory only, so a server restart invalidates every session (`:8-9`); the `globalThis` attachment keeps sessions across dev HMR only (`:41-47`). Lifetime is the constant 7 days (`:34`); at most 50 sessions, with expired purged first and then the oldest evicted (`:35`, `:94-111`). `ip` is recorded at creation and never compared at validation (`:117-122` versus `:152-165`).

`CRED-SES-02` **who mints one** — `createSession` is called by: password or dev-token login (`app/api/auth/login/route.ts:103`); WebAuthn authentication (`app/api/auth/webauthn/authenticate/route.ts:132`); first-run setup verification (`app/api/auth/setup-verify/route.ts:118`); the OS-code password reset (`app/api/governance/password/reset/route.ts:102`); and the headless login handler (`services/headless-router.ts:4385`). The dev-token login branch (CRED-DEV-03) therefore ends in the same cookie as a password login.

`CRED-SES-03` **cookie attributes** — `HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`, plus `Secure` only when the caller passes `secure=true` (`lib/session-auth.ts:240-251`). Login passes `request.url.startsWith('https')` (`login/route.ts:106`); setup-verify and password-reset call `buildSessionCookie(token)` with no second argument (`setup-verify/route.ts:124`, `reset/route.ts:110`), so those two cookies are never `Secure`.

`CRED-SES-04` **what it authorizes** — a valid cookie authenticates as the web-UI owner (CRED-GEN-03, CRED-GEN-06). Validation is `validateSession` (`:152-165`), synchronous by design (`:138-150`). Revocation: `invalidateSession` on logout (`app/api/auth/logout/route.ts:20`, `services/headless-router.ts:4393`) removes one; `invalidateAllSessions` exists (`session-auth.ts:217-219`) and has no caller in `app/`, `lib/`, `services/`, `components/` or `server.mjs` (CRED-GAP-03).

## Section 4 — The dev-mode login token (CRED-DEV)

`CRED-DEV-01` **shape, store, lifetime** — `am-` plus base64url of 32 random bytes (`lib/dev-mode-token.ts:107-108`). Only the SHA-256 hex hash is stored, in `governance.json` field `devModeLogin` as `{ enabled, tokenHash, createdAt, lastUsedAt }` (`:110-116`, `:59-61`). There is exactly one token; a new mint replaces the old one (`:103-106`). It has no expiry: it is valid until revoked or disabled. The server never reads the token from its own environment; `AI_MAESTRO_DEV_MODE_TOKEN` is a name only the shell CLI reads (`:21-25`; the CLI itself is not in this repository, CRED-UNV-02).

`CRED-DEV-02` **mint, pause, revoke gates** — all three handlers in `app/api/auth/dev-token/route.ts` call `enforceSystemOwner` (`:51`, `:110`, `:190`, `:219`; GET too), so an agent token is refused. `POST` mints only after ALL of: kill switch not active (`:98-103`); the global bucket (`:105`); `enforceSystemOwner` (`:110`); the per-caller bucket of 5 (`:113`); the correct governance password (`:133-137`); at least one registered passkey (`:142-147`); and a verified WebAuthn assertion (`:149-169`). The password alone never suffices (`:139-141`). `PATCH {enabled}` pauses or resumes without destroying the hash (`:183-206`, `lib/dev-mode-token.ts:82-93`). `DELETE` removes the whole `devModeLogin` record (`:212-224`, `lib/dev-mode-token.ts:152-157`). All three routes are declared owner-only in `SYSTEM_OWNER_ONLY_STRICT` (`lib/sudo-guard.ts:245-247`).

`CRED-DEV-03` **what it authorizes** — it is accepted at one place only: `POST /api/auth/login` with body `{ devToken }` instead of `{ password }` (`login/route.ts:20-23`, `:71-73`). `verifyDevToken` (`lib/dev-mode-token.ts:126-144`) fails closed on every miss (not a string, wrong prefix, no record, `enabled !== true`, malformed hash, mismatch via `timingSafeEqual`) and stamps `lastUsedAt` on success (`:141-143`). A successful dev-token login returns the standard session cookie (CRED-SES-02), so the token is equivalent to the owner's password for the purpose of obtaining a session, minus the security-config unlock (CRED-PWD-03). It is NOT accepted as a bearer.

`CRED-DEV-04` **production guard** — `assertDevModeAbsentInProduction` (`lib/dev-mode-token.ts:176-187`) throws when `NODE_ENV === 'production'` and a token is enabled or issued. It has NO production caller: the `server.mjs` boot call was removed by owner ruling (`server.mjs:99` comment; asserted absent by `tests/unit/server-boot-dev-mode-guard.test.ts:214-219`).

## Section 5 — The sudo token and the strict-route guard (CRED-SUD)

`CRED-SUD-01` **shape, store, lifetime** — 32 random bytes, base64url (`lib/sudo-auth.ts:34`, `:161`), stored as a SHA-256 hex key in an in-memory Map on `globalThis` (`:63-78`) with `{ expiresAt, subject, operation? }` (`:42-61`). TTL is `loadSecurityConfig().sessionAuth.sudoTokenTtlSeconds` (`:31-33`), default 60 (`lib/security-config.ts:104`), clamped to 10-600 on load (`:187`). Restart invalidates all tokens (`sudo-auth.ts:20-22`). Expired records are swept on every issue and consume and every 60 s outside tests (`:80-86`, `:281-289`).

`CRED-SUD-02` **mint** — `POST /api/auth/sudo-password` (`app/api/auth/sudo-password/route.ts`). In order: kill switch (`:72-77`); global bucket (`:83`); `authenticateFromRequest` then `buildAuthContext` (`:91-95`); `if (!ctx.isSystemOwner)` refuse 403 `sudo_user_only` (`:102-110`); subject is `ctx.userId ?? 'system-owner'` (`:121`); per-subject bucket (`:129-136`); body schema `{ password, operation? }` strict (`:54-66`); operation normalised to a strict-route template (`:157-162`); at most 2 outstanding tokens per subject, 429 `sudo_token_quota_exceeded` (`:29`, `:166-174`); `issueSudoToken` verifies the password against the model-dependent hash (`lib/sudo-auth.ts:106-138`, `:149-169`: the global governance hash when the model is off, the acting user's own hash when on). The route's only identity test is `isSystemOwner`; there is no check of origin, user agent, browser, TTY or console presence anywhere in the handler (CRED-GAP-01).

`CRED-SUD-03` **consume: authenticate before burn** — `verifyAndConsumeSudoToken` (`lib/sudo-auth.ts:212-254`) checks, in order, presence, existence, expiry, then the caller-supplied subject predicate (`:240`), then the operation binding (`:245-250`), and deletes the token ONLY on a full match (`:252`). A wrong-subject or wrong-operation attempt returns a reason without burning a valid token. An unbound token (minted without `operation`) matches any operation (`:245-250` condition, `:54-60` comment).

`CRED-SUD-04` **the guard** — `requireSudoToken(request, method, pathTemplate)` (`lib/sudo-guard.ts:63-201`), called first in a strict route's handler:

1. If `requiresSudo(method, pathTemplate)` is false for the route, return null (no-op, `:71-73`). "Strict" is the classification in `security-registry.json`.
2. Authenticate first; an auth error returns its 401/403 before any sudo token is read (`:81-84`).
3. `!ctx.isSystemOwner` takes the AGENT path to `requireAidTitle` and never touches a sudo token (`:88-90`, CRED-SUD-06).
4. Owner path: read header `x-sudo-token` (`:93`); accepted subjects are `'system-owner'` always, plus the active maestro's user id when the model is on; a read failure falls back to the legacy set only (`:120-132`); consume with the operation `{ method, pathTemplate }` (`:138-141`).
5. Failures are 403 with `error` one of `sudo_subject_mismatch` (`:145-155`), `sudo_operation_mismatch` (`:157-167`), or `sudo_required` with `reason` `missing | expired | unknown` (`:169-200`).

`CRED-SUD-05` **strict-route declaration is enforced at load** — every strict route in `security-registry.json` must be declared in exactly one of `SYSTEM_OWNER_ONLY_STRICT` (`:218-284`), `AGENT_POLICY_PENDING` (`:309-326`, currently empty), or `STRICT_AGENT_RULES` (`:378-531`); `assertStrictRoutesDeclared` throws at module load on an undeclared, non-strict or doubly-declared key (`:544-564`, invoked at `:585-592`). An absent registry file is skipped with a warning (`:575-578`).

`CRED-SUD-06` **the agent path** — `decideAidTitle` (`:744-853`) decides in order: owner-only routes deny every agent 403 `aid_title_forbidden` (`:754-761`); pending routes deny 403 `agent_policy_undefined` (`:768-778`); a route with no rule denies (`:781-793`); `deferToRoute` routes (the five `/api/trdd/[id]/*` write verbs) admit any authenticated agent past the guard and rely on the route's own `authorize('manage-trdd', …)` (`:806-808`); otherwise `authorize(auth, rule.action, targetAgentId)` decides (`:831-839`); then the portfolio pre-check (`:842-850`, CRED-PRT-05). `requireAidTitle` is the NextResponse adapter (`:860-870`). The agent path involves no sudo token at all; agents are never asked for a sudo password.

## Section 6 — The AID governance token, aim_tk_ (CRED-AID)

`CRED-AID-01` **shape, store, lifetime** — `aim_tk_` plus 64 hex (`lib/aid-token.ts:372`); the store keeps the SHA-256 hash with `sha256:` prefix (`:174-176`) in `~/.aimaestro/governance-tokens/active-tokens.json`, directory `0o700`, file `0o600` (`:80`, `:105-113`, `:163-172`). Lifetime is 3600 s (`:78`). At most 200 live records: issuing keeps the newest 199 plus the new one (`:391-395`). An in-memory copy is trusted for 5 s (`:87`, `:123-127`), so a revocation can be invisible to validation for up to 5 s in the same process (CRED-UNV-03 for multi-process).

`CRED-AID-02` **how an agent obtains one** — a two-step proof-of-possession over Ed25519:

1. `POST /api/v1/auth/challenge` returns a single-use nonce. The route is anonymous by design and whitelisted (`app/api/v1/auth/challenge/route.ts:11-28`; `middleware.ts:69`); the nonce lives 30 s (`lib/aid-nonce.ts:51`), is 32 random bytes (`:54`), the store caps at 10 000 (`:58`), and the nonce is bound to the CLAIMED fingerprint.
2. `POST /api/v1/auth/token` (`app/api/v1/auth/token/route.ts`): grant type must be `urn:aid:agent-identity` (`:40`); the agent is found by fingerprint, falling back to alias (`:98-109`); its stored public key is loaded (`:119`); the proof is `base64url(signature 64 bytes || nonce)` over `aid-token-exchange\n{nonce}\n{server_url}` (`lib/aid-token.ts:294-327`, `:313`); the `server_url` is hard-coded to `http://localhost:{PORT||23000}` and never taken from a forwarded header (`token/route.ts:132`); the signature is verified BEFORE the nonce is consumed (`:137-165`); consumption is single-use and fingerprint-bound (`:158`). Rate limits: global 200, per-identity 30 per minute, the per-identity bucket reset on success (`:29`, `:85`, `:251`).
3. The title and team put into the token come from the REGISTRY at mint time (`:171-185`), or from the signed ledger when `enforceAidAssociation` is on and the AID has no current association (`:187-218`). The token `scope` defaults to `'governance'` (`:237`).

The older timestamp-window proof (`verifyProofOfPossession`, `lib/aid-token.ts:192-234`, ±300 s at `:79`) still exists and is not used by the token route.

`CRED-AID-03` **subject classes and who mints each** — one prefix is minted for both subject classes: `issueGovernanceToken` sets `subject_type` absent (read as agent, `:23-42`) and `issueUserGovernanceToken` sets `subject_type: 'user'`, `user_title`, `team_id: null` and puts the USER id in `agent_id` (`:417-460`); both build the token at `:372` and `:423` from the same `TOKEN_PREFIX`. The discriminator is `subject_type`, not the prefix. Callers: `issueGovernanceToken` has exactly one production caller, `app/api/v1/auth/token/route.ts:240`. `issueUserGovernanceToken` has NO caller in `app/`, `lib/` (outside its own file), `services/`, `server.mjs` or `scripts/` (CRED-GAP-08); the user branch of `authenticateAgent` (`lib/agent-auth.ts:142-165`) is reachable only by a record present in the token store, whether written by the unused function or placed in the file directly (CRED-UNV-01).

`CRED-AID-04` **validate** — `validateGovernanceToken` (`:472-507`): wrong prefix returns null; an unreadable or corrupt store REJECTS (`:479-484`, never accepts, never crashes); hash lookup in an index Map then `timingSafeEqual` on the single candidate (`:491-502`); expiry check (`:505`). The record is returned verbatim; the caller branches on `subject_type`.

`CRED-AID-05` **user-subject gating in the auth path** — a user-subject token whose user record is foreign (`native === false`) and not approved by this host's maestro is refused 403 (`lib/agent-auth.ts:147-155`); a failure to read the user record fails closed with 401 (`:156-160`).

`CRED-AID-06` **revocation** — `revokeTokensForAgentCompensable` removes every record whose `agent_id` equals the id and returns a `restore` closure (`:538-554`); it runs under `withLock('governance-tokens')`. It is invoked on agent deletion (`services/element-management-service.ts:9783`) and on a title change (`:3572`). A soft delete does not revoke: the holder is refused at authentication instead (`lib/agent-auth.ts:175-181`, CRED-GEN-04). There is no per-token revoke route in this module; expiry is the other exit.

## Section 7 — The session secret, mst_ (CRED-MST)

`CRED-MST-01` **shape and store** — `mst_` plus 64 hex (`lib/session-secret.ts:40`); only `sha256:<hex>` is stored, in the agent's registry metadata field `sessionSecretHash` (`:76-78`; read at `lib/agent-auth.ts:492`). Validation is constant-time over fixed-length hashes (`session-secret.ts:53-63`). The check has no expiry: a secret is valid for as long as its hash stays in the registry.

`CRED-MST-02` **issuance** — only the server mints it, when it builds a session environment: `buildAgentSessionEnv` generates a fresh pair, writes the hash through `ChangeMetadata` under a system auth context (`lib/session-env.ts:127-141`), and only then puts the plaintext in the environment variable `AID_AUTH` (`:147`). If the registry id is missing or the write fails, the session starts WITHOUT `AID_AUTH` and every API call from it returns 401 (`:109-122`, `:150-155`). Callers: `services/agents-core-service.ts:62` and `services/sessions-service.ts:35` import it. Each build overwrites the previous hash, so the previous secret stops validating.

`CRED-MST-03` **resolution** — `findAgentBySessionSecret` walks all non-deleted agents and compares each stored hash (`lib/agent-auth.ts:484-508`); a registry failure denies (`:498-507`). The title and team in the result are re-read from the registry on every call, so a title change takes effect on the next request with no re-mint (`:225-231`, `:538-555`); a failure inside that lookup degrades to title `autonomous` and no team with a logged warning rather than a refusal (`:546-554`).

`CRED-MST-04` **revocation and transport** — hibernate clears the hash (`services/agents-core-service.ts:2759`, errors swallowed `:2760`); `sessionSecretHash` is a system-owned metadata key that callers cannot set (`services/element-management-service.ts:7848`); agent export, transfer and import strip it (`services/agents-transfer-service.ts:418`, `:795`; `services/agents-core-service.ts:642`). Revocation on a kill that does not go through hibernate is UNVERIFIED (CRED-UNV-06).

## Section 8 — AMP API keys and Ed25519 keypairs (CRED-AMP)

`CRED-AMP-01` **shape, store, lifetime** — `amp_live_sk_` (or `amp_test_sk_`) plus 64 hex; valid format means exactly 76 characters with one of the two prefixes (`lib/amp-auth.ts:154-159`). Stored as `{ key_hash (sha256:), agent_id, tenant_id, address, created_at, expires_at: null, status: 'active' }` in `~/.aimaestro/amp-api-keys.json`, mode `0o600`, atomic write (`:20`, `:94-108`, `:179-187`). A 30 s in-memory cache fronts the file (`:45`, `:54-80`); a file that fails to parse is cached as EMPTY for 30 s (`:73-79`), meaning every key then fails validation.

`CRED-AMP-02` **validate** — `validateApiKey` (`:207-257`) scans every record with `timingSafeEqual`, accepts only `status === 'active'` and not past `expires_at` (`:226-237`), and stamps `last_used_at` at most once per 60 s (`:204-205`, `:245-253`). `authenticateRequest` wraps it (`:525-552`) and returns `agentId`, `tenantId`, `address`.

`CRED-AMP-03` **issuance** — `createApiKey` (`:169-197`) is called from `registerAgent` (`services/amp-service.ts:692`), reached through `POST /api/v1/register`, which is whitelisted from credentials (`middleware.ts:63`). The route is IP rate-limited at 5 and globally at 60 (`app/api/v1/register/route.ts:41-60`). The registrant supplies an Ed25519 public key and a name (`services/amp-service.ts:575-584`); the code shows no proof of possession of the private key and no other credential, apart from an optional `Bearer uk_` header that only supplies the tenant (`:520-531`). Re-registration of an existing AMP-registered name is accepted when the supplied key's fingerprint equals the stored one, and re-issues an API key (`:626-631`); the fingerprint is computed from the public key alone (`:584`).

`CRED-AMP-04` **rotate and revoke** — `rotateApiKey` creates a new key and gives the old one a 24 h grace expiry (`lib/amp-auth.ts:28`, `:291-339`); `revokeApiKey` sets `status: 'revoked'` (`:344-367`); `revokeAllKeysForAgentCompensable` flips an agent's active keys and returns a restore closure that restores only the keys it flipped (`:398-426`); it runs on agent deletion (`services/element-management-service.ts:9779`). Routes: `DELETE /api/v1/auth/revoke-key` and the rotate route call `revokeKey` / `rotateKey` in `services/amp-service.ts:1838`, `:1867`.

`CRED-AMP-05` **what an AMP key authorizes** — through `authenticateAgent` an AMP key authenticates the holder as an agent with `{ agentId }` only (`lib/agent-auth.ts:234-261`); no title and no team are set. It is therefore accepted by every route that uses `authenticateFromRequest`, not only the messaging routes (CRED-GAP-07). A soft-deleted holder is refused (`:254-259`).

`CRED-AMP-06` **the Ed25519 keypair** — one keypair per agent under `~/.aimaestro/agents/{id}/keys/`, private key `0o600` written atomically, public key `0o644` (`lib/amp-keys.ts:167-183`, directories `0o700` at `:89,93`); agent ids are validated against traversal (`:50-59`). It is the root of the AID proof (CRED-AID-02) and of message signing; its public half is accepted from any registrant (CRED-AMP-03).

## Section 9 — Portfolio, approval and verdict tokens (CRED-PRT)

`CRED-PRT-01` **what they are** — host-signed records in a per-subject enclave `~/.aimaestro/agents/portfolios/{subjectAgentId}.json` (`lib/portfolio-store.ts:30`), never presented as a bearer. A token carries `token_id` (UUID), `kind` (`approval | mandate`), `subject_agent_id`, `scope`, optional pins `target_agent_id`, `target_team_id`, `target_trdd_id`, `issuer_agent_id`, `issuer_title` (`manager | chief-of-staff | user`), `uses_remaining`, `issued_at`, `expires_at`, `issuer_sig`, `ledger_seq`, `status` (`types/portfolio.ts:27-106`). The human owner is recorded as issuer id `system-owner` with title `user` (`:53`, `app/api/agents/[id]/portfolio/route.ts:197-202`).

`CRED-PRT-02` **signature and anchor** — the signature is Ed25519 with the HOST key over a deterministic positional JSON that omits `issuer_sig`, `ledger_seq` and `status` (`lib/portfolio-sign.ts:37-65`, `:72-89`), verified against the current or previous host key (`:85`). A token is trusted only if it is also anchored in the host-signed portfolio ledger: `ledger_seq` must resolve to an `issue_portfolio_token` entry (`lib/portfolio-check.ts:182-195`).

`CRED-PRT-03` **who may mint which scope** — `canIssue` (`lib/portfolio-issue-guard.ts:54-106`): the owner may mint anything (`:66-68`); a MANAGER may mint anything (`:73-75`); a CHIEF-OF-STAFF may mint only `mandate` tokens, only scope `agent:create`, only for a member of a team it chairs, decided from the team registry (`:40-42`, `:78-102`); everyone else is refused. No sudo token is consulted. The route is `POST /api/agents/[id]/portfolio` (`route.ts:105-293`); it is deliberately not sudo-gated (`:27-33`). Defaults: an `approval` token lives at most 3600 s and has one use; a `mandate` token lives at most 30 days with unlimited uses (`:42-44`, `:209-224`). A token is refused at mint when no ledger anchor can be written: the record is revoked and 503 returned (`:260-276`).

`CRED-PRT-04` **verify** — `explainPortfolioToken` (`lib/portfolio-check.ts:168-283`) returns a verdict with eight named checks: signature, ledger anchor, issuer's current title (the issuer must still exist, be undeleted and hold the title it minted under, `:125-150`), status active, not expired, uses available, scope satisfied (exact match or `resource:*` or `*:*`, `:112-118`), and target pin. Unasked checks are `null`, not true (`:66-81`). `valid` is every check true or null (`:260`).

`CRED-PRT-05` **where the gate would bite, and its shipped state** — `OPERATIONS_REQUIRING_TOKEN` is EMPTY (`lib/portfolio-check.ts:34-45`). With it empty, `matchPortfolioToken` (`:296-336`) and the guard pre-check `requirePortfolioToken` (`lib/sudo-guard.ts:680-715`) return allowed for every operation. When an operation is added, only delegated callers are gated: the owner (`ctx.isSystemOwner`, `portfolio-check.ts:302`; no `agentId`, `:304`) and a MANAGER (`:312`) bypass. The guard maps `POST /api/agents` to `CreateAgent` and `POST /api/teams`, `POST /api/teams/create-with-project` to `CreateTeam` (`sudo-guard.ts:398`, `:427`, `:434`, `:637-641`).

`CRED-PRT-06` **TRDD approval and verdict tokens** — `POST /api/trdd/[id]/approve` and `POST /api/trdd/[id]/promote` mint a token INSIDE the already-authorized critical section (`app/api/trdd/[id]/approve/route.ts:60-77`, `promote/route.ts:142-153`) via `mintTrddDecisionToken` (`lib/trdd-approval-token.ts:126-180`): host-signed, ledger-anchored, pinned to the card id, 30-day expiry, never consumed (`uses_remaining: null`, `:112`, `:152-154`), scope `trdd:approve` for an approval (`:55`) and `trdd:verdict:<from>:<to>` for a move out of a review column (`:66-79`, `:97-99`). The token id is written to the card's frontmatter (`approval-token`, `mandate-token`, `verdict-token`, `:82`, `:102-103`). A null mint (ledger unavailable) does not fail the approval (`:168-173`, route comments).

`CRED-PRT-07` **what verification covers** — `GET /api/trdd/[id]/verify` (`app/api/trdd/[id]/verify/route.ts:185-212`) is NOT strict and NOT sudo-gated; it needs only an authenticated caller. `verifyTrddDecision` (`lib/trdd-approval-token.ts:281-366`) takes ONLY the token id from the card, derives the approver from the signed token, and compares the signed `issuer_title` rank to the card's `min-approval-requirement` (`:345-347`). The token binds the card's identity, never its content (the file header says so, `:32-40`). The verdict half is checked apart from the approval half and re-checks that the recorded move leaves a review column and matches the card's current column (`:217-274`). The only caller of `verifyTrddDecision` is that verify route (CRED-GAP-10).

## Section 10 — The headless router (CRED-HDL)

`CRED-HDL-01` **differences from full mode** — `services/headless-router.ts` mirrors the credential gate: the cookie regex requires 20 or more characters and the bearer payload 24 or more (`:4918-4944`, versus 10 in `middleware.ts:112,117`), and it adds a semantic gate that actually validates the credential with `authenticateFromRequestAsync` before a handler runs (`:4946` onward and the call near `:5075-5078`). The headless login handler accepts `{ password }` only: there is no `devToken` branch (`:4363-4382`), so the dev-mode token is full-mode only. `/api/auth/sudo-password` is not served in headless mode, so no sudo token can be minted there (`:4840`); a strict route in headless mode succeeds only for a caller already holding a token.

## Section 11 — Where a comment's intent and the enforced predicate differ (CRED-GAP)

Recorded because that gap misled callers twice. Each entry states the comment, the predicate, and what follows.

`CRED-GAP-01` **sudo-password: "only of the USER, only via the UI"** — the route header and the gate comment say a sudo password may be requested ONLY of the USER and ONLY via the UI (`app/api/auth/sudo-password/route.ts:97-101`). The enforced predicate is `if (!ctx.isSystemOwner)` (`:102`), which refuses authenticated AGENTS. With the model off (default) `isSystemOwner` is `!agentId` (`lib/agent-auth.ts:427`), so any authenticated non-agent caller passes from any HTTP client; the handler contains no origin, user-agent, console or TTY test (the whole file, `:70-204`). The owner-from-a-shell case was measured HTTP 200 by TRDD-LS1UNUP1's author; it was not re-measured when writing this spec (derived from the predicate).

`CRED-GAP-02` **session secret: "dies when session is killed/restarted"** — `lib/session-secret.ts:15` says the secret's scope is per-session and dies with the session. The validator has no expiry (`:53-63`); the hash is cleared on hibernate (`services/agents-core-service.ts:2759`) and replaced on the next session build (`lib/session-env.ts:131-141`). A kill that bypasses both leaves the hash valid (CRED-UNV-06).

`CRED-GAP-03` **`invalidateAllSessions` "when governance password changes"** — the doc comment at `lib/session-auth.ts:214-216` names that use; the function has no caller (CRED-SES-04) and `setPassword` (`lib/governance.ts:197-212`) does not touch sessions. A password change therefore does not end existing cookies.

`CRED-GAP-04` **configurable session TTL is not read** — `sessionAuth.sessionTtlDays` is stored, clamped 1-90 on load (`lib/security-config.ts:57`, `:103`, `:188`), validated by `PATCH /api/settings/security` (`app/api/settings/security/route.ts:45`) and shown in the UI (`components/settings/SecuritySection.tsx:597`). `lib/session-auth.ts` imports nothing from the security config and fixes the lifetime at `7 * 24 * 60 * 60 * 1000` (`:34`). No file under `app/`, `lib/`, `services/`, `components/` or `server.mjs` outside those four reads the setting.

`CRED-GAP-05` **portfolio gate "populated" versus empty** — a comment at `lib/sudo-guard.ts:626-632` states that `OPERATIONS_REQUIRING_TOKEN` is populated with `CreateAgent` and `CreateTeam` and that the portfolio requirement is ON for delegated callers. `lib/portfolio-check.ts:34-45` has the map empty and says enabling it is a deliberate governance decision. The code is the empty state (CRED-PRT-05).

`CRED-GAP-06` **dev token "minted ONLY from Settings"** — `lib/dev-mode-token.ts:4-9` says the token is minted only from Settings, Security. The route's gates are `enforceSystemOwner`, the governance password and a WebAuthn assertion in the request body (CRED-DEV-02); none depends on the request coming from a browser UI, so any owner-session HTTP client that can produce the assertion passes.

`CRED-GAP-07` **AMP key "message routing only"** — `lib/aid-token.ts:8-10` describes AMP keys as the credential for message routing and `aim_tk_` for governance. `authenticateAgent` accepts an AMP key on every route that uses it and yields `{ agentId }` with no title (CRED-AMP-05); which routes then admit an untitled agent is a per-route authorization question this spec does not answer (CRED-UNV-07).

`CRED-GAP-08` **one prefix, two subjects, one minter** — `aim_tk_` is minted for both subject classes by two functions (CRED-AID-03), but only the agent function has a production caller. A statement that a real `aim_tk_` token "needs a live human session token" is false for the agent class (`POST /api/v1/auth/token` needs only the agent's Ed25519 key); a statement that user-subject `aim_tk_` tokens are in circulation is unsupported by any caller in this tree.

`CRED-GAP-09` **token `scope` is stored and not carried** — `issueGovernanceToken` records `scope` (default `'governance'`, `lib/aid-token.ts:370-385`), and `authenticateAgent` returns `{ agentId, governanceTitle, teamId }` without it (`lib/agent-auth.ts:191-195`). The scope narrows nothing in the authentication result.

`CRED-GAP-10` **approval token "makes R41 true" but nothing enforces it** — `lib/trdd-approval-token.ts:1-40` presents the token as the binding that makes an approval verifiable. Its only consumer is the read-only verify route (CRED-PRT-07); no gate, route or pipeline refuses an action because a card's token is missing or fails verification. The token is a RECORD that can be queried, not a gate.

`CRED-GAP-11` **first-run: the session endpoint says authenticated, the API says 401** — `GET /api/auth/session` returns `authenticated: true, passwordNotSet: true` when no password hash exists (`app/api/auth/session/route.ts:21-33`), while `authenticateAgent` returns 401 `first_run_required` to a cookie-less caller in the same state (`lib/agent-auth.ts:100-108`). The two answer different questions (may the UI proceed to setup, versus may this API call run) and use different words.

`CRED-GAP-12` **`authenticateAgent` header lists four outcomes** — `lib/agent-auth.ts:7-11` lists session, `aim_tk_`, AMP key and failure. The body also returns the user-subject `aim_tk_` result, the `mst_` result, the 403 outcomes (foreign user, mismatched `X-Agent-Id`, ledger gate) and, on the async path, the IBCT result (CRED-GEN-03, CRED-GEN-04).

## Section 12 — What this spec could not verify (CRED-UNV)

`CRED-UNV-01` **user-subject tokens in the store** — UNVERIFIED whether any `subject_type: 'user'` record exists on a running host. The code shows no minter (CRED-AID-03); it does not show that nothing else writes the store file.

`CRED-UNV-02` **the shell CLI's use of the dev token** — UNVERIFIED. `AI_MAESTRO_DEV_MODE_TOKEN` is read by a shell CLI that is not in this repository (`lib/dev-mode-token.ts:21-25`); nothing here shows how it reads or sends the value.

`CRED-UNV-03` **multi-process token visibility** — UNVERIFIED. The AID token cache, the session Map, the sudo Map and the nonce store are all process-local (`lib/aid-token.ts:87-99`, `lib/session-auth.ts:55-57`, `lib/sudo-auth.ts:63-70`, `lib/aid-nonce.ts:36-45`); this spec does not claim behaviour under more than one server process.

`CRED-UNV-04` **file modes on a live host** — UNVERIFIED. Only the `mode` arguments in code are cited (CRED-PWD-01, CRED-AID-01, CRED-AMP-01); no live file was inspected.

`CRED-UNV-05` **IBCT internals** — UNVERIFIED and out of scope: `lib/ibct.ts` (issuer rules beyond `aip:key:ed25519:`, TTL, scope grammar, the `/api/v1/auth/ibct` route) was not read for this spec.

`CRED-UNV-06` **session-secret revocation on kill paths other than hibernate** — UNVERIFIED. Only `services/agents-core-service.ts:2759` was found clearing the hash; other session-stop routes were not read.

`CRED-UNV-07` **per-route admission of an untitled agent** — UNVERIFIED. `lib/authorization.ts::authorize` was read only for its callers' contract; which actions admit an agent with no `governanceTitle` (the AMP key case) is not stated here.

`CRED-UNV-08` **model-ON behaviour of the sudo agent path for a non-maestro user** — UNVERIFIED. With the model on, a user session whose title is `user` has `isSystemOwner` false (CRED-GEN-06) and so takes the agent path of the guard (`lib/sudo-guard.ts:88-90`); what `authorize` then returns for a caller with no `agentId` was not traced.

`CRED-UNV-09` **WebAuthn internals and the first-run, reset and kill-switch flows** — UNVERIFIED beyond the `createSession` call sites in CRED-SES-02. `lib/webauthn-server.ts`, `lib/kill-switch.ts` and `lib/rate-limit.ts` were not read.

## Section 13 — Conformance

`CRED-CNF-01` **no conformance test yet** — TRDD-LS1UNUP1's verification asks for a test asserting each declared prefix constant still equals this spec's value. That test does not exist; until it does, a renamed prefix constant makes CRED-GEN-01 stale without any check noticing. The constants to pin are `aim_tk_`, `mst_`, `amp_live_sk_`, `amp_test_sk_`, `am-`, `AI_MAESTRO_DEV_MODE_TOKEN`, `aim_session`, the header name `x-sudo-token`, and the scope strings `trdd:approve` and `trdd:verdict`.
