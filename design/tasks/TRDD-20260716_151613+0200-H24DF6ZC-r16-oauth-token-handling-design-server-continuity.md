---
trdd-id: H24DF6ZC
title: R16 OAuth token-handling design for server-side continuity (USER sign-off gates implementation)
column: design
created: 2026-07-16T15:16:13+0200
updated: 2026-07-16T19:21:48+0200
current-owner: ai-maestro
task-type: security
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T15:16:13+0200
relevant-rules: [16]
labels: [r16, oauth, credentials, keychain, security, design, sign-off-gate]
external-refs: [Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
release-via: none
---

# R16 OAuth token-handling design for server-side continuity (USER sign-off gates implementation)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-16

**Born approved to AUTHOR (USER mandate).** The USER mandated the janitor-absorption
initiative including "the oauth key rotations". This TRDD is the **NPT of [[TRDD-KCRMSNL7]]**
that designs HOW the server handles OAuth token material — because Family-A's OAuth-manager /
account-switcher NPTs (KCRMSNL7 #2/#3) cannot be built safely without this design fixed first.

**✅ SIGNED OFF by the USER 2026-07-16 — the hard gate is CLEARED.** All four: D1 (token
infra-only + browser-automation refinement) · D2 (keychain-only, no plaintext) · D3 (the
daemon's EXACT tested write-mutex + never touch the OS-keychain lock state) · D4 (the 3-tier
ROTATE→REFRESH→REAUTH progressive-fallback cascade, REAUTH the only human step, session-only,
no stored password). `approved: true` in the frontmatter always meant "approved to DESIGN"; the
separate implement sign-off the USER reserved is now GIVEN — see per-item verdicts in
`## Approval log`.

**NEXT ACTION:** the token-touching NPTs under KCRMSNL7 (#2 OAuth manager, #3 account switcher)
are UNBLOCKED. Proceed to plan-mode decompose KCRMSNL7 (Family-A), building the token parts to
THIS signed design.

## The four constraints (janitor #100 Q5 — ACCEPTED as binding; this design instantiates them)

1. **Token material is infrastructure-only.** It NEVER appears in any agent- or model-readable
   API/CLI response. `aimaestro-continuity.sh status` returns exactly 5 metadata fields
   (`account_healthy, window_5h_pct, window_7d_pct, cache_ttl_minutes, next_action`) — a
   deliberate ceiling, chosen so no token can leak through the one verb an agent can call.
2. **Encrypted at rest in the OS secret store — never a plaintext file.** Match the janitor's
   keychain posture: the live credential is the OS-managed `Claude Code-credentials` item; the
   rotator's spare slot + mirror go through platform `safe_storage` (macOS `security` /
   Linux libsecret / Windows DPAPI). Any on-disk index holds **metadata only** (which account,
   plan, window regime, last-rotated timestamp) — never the token.
3. **ONE writer, machine-wide-locked.** The server owns the credential-write lock when it is up;
   the `#N` daemon owns it when there is no server; the two are **mutually exclusive by
   construction** — the server acquires the SAME machine-wide lock the daemon uses
   (`daemon.flock` equivalent), never a second independent lock. This is the seam that, if wrong,
   corrupts the live credential; it is designed to be impossible-to-double-write, not
   unlikely-to.
4. **REAUTH stays human.** The cascade is **ROTATE / RENEW automatic, REAUTH human.** The server
   DETECTS a dead refresh token (rotation exhausted / refresh rejected) and surfaces a `/login`
   nudge to the human via the OS presence channel (reuse `lib/setup-bootstrap.ts` — the same
   desktop-notification presence path the password-invalidation feature uses). It NEVER automates
   re-auth with stored material and NEVER prompts the model for a credential.

## Token operations run as DETACHED, MODEL-FREE INFRA (USER refinement, 2026-07-16 — D1)

D1 is SIGNED OFF with this refinement. The three continuity operations — **ROTATE, REFRESH
(renew), REAUTH** — may not be pure token exchanges: obtaining, validating, or backing up a
credential can require driving the claude.ai website with a **headless browser**
(dev-browser / puppeteer / playwright). That work runs as a **standalone detached process
spawned by the server/daemon, NOT inside any Claude/agent context** — a Node/puppeteer process
that reads/writes the keychain (D2) directly. Why this still satisfies R16:
- no model is in the loop, so the token never appears in a transcript;
- the process is headless + unattended; it VALIDATES the new credential with a probe call and
  BACKS UP the last-known-good to the rotator spare/mirror BEFORE overwriting;
- it holds the one machine-wide write lock (D3) for the write.

**The sub-choice this defers to D4 (REAUTH automation vs the human gate):** persisting a
claude.ai browser session/profile lets ROTATE/REFRESH — and REAUTH while that session is
valid — run with NO human. When even the session dies:
- **(i) session-only [recommended]:** persist the browser profile only; on a dead session fall
  back to the D4 human `/login` nudge. No account password stored.
- **(ii) stored-credential:** additionally store the account login in `safe_storage` so the
  headless browser re-logs-in with no human ever — removes the human entirely but stores
  impersonation-grade material (a strictly larger blast radius than the OAuth token alone).
Either way the automation is model-free; (i) vs (ii) is purely how far to push human-free reauth.

## D3 SIGNED OFF — the write mutex is the daemon's, the keychain LOCK is the OS's (USER, 2026-07-16)

Two DISTINCT locks, and the USER separated them:
- **The write-coordination mutex (what D3 / Constraint 3 means): use the daemon's EXACT tested
  machine-wide lock — do NOT invent a second one.** The server takes the SAME lock the `#N`
  daemon already uses; it is a proven mechanism, so replicate it verbatim rather than design a
  new one. (Same intent as Constraint 3, now pinned to "copy the daemon, don't reinvent".)
- **NEVER programmatically lock or unlock the macOS keychain itself.** The keychain's LOCK STATE
  is OS-managed and auto-locks (timeout / sleep / screensaver). The server reads/writes keychain
  ITEMS through the API but NEVER calls `SecKeychainLock`/`Unlock`. Touching the lock state is a
  known trap: `SecKeychainUnlock` on an already-unlocked keychain returns success WITHOUT checking
  the password, and `security unlock-keychain -p PASS` leaks the passphrase on argv.
- **Follow the daemon's EXACT tested keychain-ACCESS path.** A long-running server/daemon can
  otherwise fail to read the login keychain (a process-context inheritance issue); the daemon has
  already solved this, so the server matches its approach rather than rediscovering it.

## D4 SIGNED OFF — the 3-tier progressive-fallback cascade (USER, 2026-07-16)

The continuity cascade is three PROGRESSIVE fallbacks, tried in order; each escalates only when
the cheaper step fails for a specific reason. **REAUTH is the ONLY human step; ROTATE and REFRESH
are and MUST be fully automated** (detached, model-free — per the D1 refinement).

| # | Step | Uses | Automated? | Escalates when |
|---|---|---|---|---|
| 1 | **ROTATE** | the OAuth refresh_token → new access token | YES — auto | rotate fails because it needs a NEW OAuth token → REFRESH |
| 2 | **REFRESH** | the live claude.ai session COOKIE (headless browser re-runs the OAuth flow) → new OAuth token | YES — auto | refresh fails because it needs a NEW cookie → REAUTH |
| 3 | **REAUTH** | a fresh HUMAN login at claude.ai → new cookie/session | NO — **the only human step** (the `/login` desktop nudge) | — |

This IS the (i) session-only depth from the D1 refinement: the persisted browser cookie/session
makes REFRESH automatic; when even the cookie is dead, REAUTH = human login. **No account password
is stored — the human re-login IS the reauth.** Steps 1-2 hold the D3 write-mutex for the write and
validate-then-backup before overwriting the keychain item (D2).

## AgentlensPro is out of the trust boundary (confirmed with code)

AgentlensPro emits **no** token material and has **no** rotation capability (AgentlensPro#3,
`accountInfo.ts:10-13` — it lifts identity/plan metadata only, through a single choke-point that
drops the secret). So the observe-only boundary this design assumes is real and on the record:
the server READS account/window/cache metadata from AgentlensPro to compute `status`; rotation
and token custody are THIS server's infrastructure alone.

## Sign-off gate (the deliverable to the USER)

Before ANY token-touching implementation, the USER must explicitly approve, at minimum:

- **Custody:** the live credential stays the OS keychain item; the rotator spare + mirror use
  platform `safe_storage`; no plaintext token file is ever written. (Constraint 2.)
- **The one-writer lock mechanism** — the exact machine-wide lock the server shares with the
  `#N` daemon, and the acquire/release ordering that makes concurrent credential writes
  impossible. (Constraint 3 — the highest-risk item.)
- **The auto/human cascade boundary** — ROTATE and RENEW are automatic; REAUTH surfaces a human
  `/login` nudge and stops. (Constraint 4.)
- **The `status` 5-field ceiling** as the only agent-reachable surface, with a schema test that
  fails CI if a sixth (token-adjacent) field is ever added. (Constraint 1.)

On sign-off: record it in `## Approval log` below (judge = USER, datetime), then unblock
KCRMSNL7 #2/#3. Until then this stays in `design` and no token code is written.

## Approval log

- 2026-07-16T15:16:13+0200 — MANDATE to AUTHOR issued by USER (min-approval-requirement: user).
  This authorizes writing the design. It does NOT authorize implementing the token handling —
  that is a SEPARATE explicit USER sign-off (see `## Sign-off gate`), not yet given.
- 2026-07-16T19:16:08+0200 — **D1 SIGNED OFF** by USER (judge: user): token infra-only, models/
  agents never read or write it, the daemon-as-server-function IS the infra that does. 5-field
  `status` ceiling stands. Refinement recorded in "## Token operations run as DETACHED, MODEL-FREE
  INFRA": the 3 ops (rotate/refresh/reauth) may use headless browser automation, run as a detached
  model-free process; the reauth (i)/(ii) sub-choice is deferred to D4.
- 2026-07-16T19:16:08+0200 — **D2 SIGNED OFF** by USER (judge: user): encrypted at rest in the OS
  keychain ONLY — no plaintext token file ever; on-disk index holds metadata only.
- 2026-07-16T19:18:01+0200 — **D3 SIGNED OFF** by USER (judge: user): the write-coordination mutex
  is the daemon's EXACT tested machine-wide lock (no second lock invented); the server NEVER
  locks/unlocks the OS keychain (OS auto-locks it — access ITEMS only, never the lock STATE);
  follow the daemon's proven keychain-access path. See "## D3 SIGNED OFF — the write mutex is the
  daemon's...".
- 2026-07-16T19:21:48+0200 — **D4 SIGNED OFF** by USER (judge: user): the cascade is a 3-tier
  PROGRESSIVE fallback — ROTATE (auto, refresh_token) → REFRESH (auto, headless browser + session
  cookie) → REAUTH (human login for a new cookie). REAUTH is the ONLY human step; ROTATE + REFRESH
  are fully automated. This is (i) session-only — no account password stored. See "## D4 SIGNED
  OFF — the 3-tier progressive-fallback cascade".
- 2026-07-16T19:21:48+0200 — **✅ ALL FOUR (D1–D4) SIGNED OFF by USER — the implement gate is
  CLEARED.** The token-touching NPTs under KCRMSNL7 (#2 OAuth manager, #3 account switcher) are
  UNBLOCKED and must be built to THIS signed design.
