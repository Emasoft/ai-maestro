---
trdd-id: H24DF6ZC
title: R16 OAuth token-handling design for server-side continuity (USER sign-off gates implementation)
column: design
created: 2026-07-16T15:16:13+0200
updated: 2026-07-16T15:16:13+0200
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

**⚠ THE ONE HARD GATE IN THIS INITIATIVE — read `## Sign-off gate`.** Authoring this design is
mandated; **IMPLEMENTING any code that reads / writes / moves / persists live OAuth token
material is BLOCKED until the USER explicitly signs off THIS design.** `approved: true` here
means "approved to design", NOT "approved to implement the token handling". The USER stated it
directly: *"the R16 token design … goes to you for explicit sign-off before any implementation."*

**NEXT ACTION:** present this design to the USER for the explicit sign-off. On sign-off, the
implementation NPTs under KCRMSNL7 (#2 OAuth manager, #3 account switcher — the token-touching
parts) unblock. Until then, Family A is built only up to the token boundary.

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
