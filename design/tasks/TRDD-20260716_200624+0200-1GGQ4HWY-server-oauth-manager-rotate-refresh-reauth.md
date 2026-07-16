---
trdd-id: 1GGQ4HWY
title: Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)
column: planned
created: 2026-07-16T20:06:24+0200
updated: 2026-07-16T20:06:24+0200
current-owner: ai-maestro
task-type: security
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T19:21:48+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, oauth, keychain, credentials, security, npt, token-touching]
external-refs: [Emasoft/ai-maestro-janitor#100, Emasoft/ai-maestro-janitor#82]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: [DXJZM3BW]
release-via: none
---

# Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Token-touching — the implement gate is CLEARED.** The USER signed off all four design
decisions of [[TRDD-H24DF6ZC]] on 2026-07-16 (D1-D4), which explicitly UNBLOCKED this NPT. This
is a **mandate** (`mandated-by: user`, `approval-datetime` = the D4 sign-off). **Build to the
SIGNED design; do NOT re-derive it.** Blocked on [[DXJZM3BW]] (the `status.next_action` field
this manager computes is emitted through that verb). **NEXT ACTION:** implement the cascade as a
detached, model-free process that reads/writes the keychain directly under the daemon's
machine-wide write mutex.

## Problem / Goal

Keep agents running through OAuth token expiry with no manual step, while NEVER letting any
model/agent read or write the token. This NPT is the server-side infrastructure that DETECTS
token expiry and runs the continuity cascade. It is the highest-risk item in Family-A: a wrong
write corrupts the live credential.

## Build to the four SIGNED invariants of [[TRDD-H24DF6ZC]] (do not re-derive)

- **D1 — detached, model-free INFRA.** The cascade runs as a **standalone detached process
  spawned by the server** (Node/puppeteer/dev-browser), NOT inside any Claude/agent context, so
  the token never enters a transcript. It VALIDATES the new credential with a probe call and
  BACKS UP the last-known-good BEFORE overwriting. The only agent-reachable surface is
  [[DXJZM3BW]]'s 5-field `status` — this manager supplies `next_action`.
- **D2 — keychain-only, no plaintext.** Live credential = the OS-managed `Claude Code-credentials`
  keychain item; the rotator spare + mirror go through platform `safe_storage`. Any on-disk index
  holds **metadata only** (account, plan, window regime, last-rotated ts).
- **D3 — TWO DISTINCT locks.** (a) Take the **daemon's EXACT tested machine-wide write mutex**
  (`daemon.flock` equivalent) — do NOT invent a second lock; it is shared with the `#N` daemon and
  makes concurrent credential writes impossible by construction. (b) NEVER call
  `SecKeychainLock`/`Unlock` — the OS auto-locks; access keychain ITEMS only, never the lock STATE.
  Follow the daemon's proven keychain-ACCESS path (it already solved the long-running-process
  login-keychain inheritance trap).
- **D4 — the 3-tier PROGRESSIVE cascade.** ROTATE (auto, `refresh_token` → new access token) →
  on failure REFRESH (auto, headless browser + persisted claude.ai session COOKIE → new OAuth
  token) → on failure REAUTH (**the only human step** — a `/login` desktop nudge via
  `lib/setup-bootstrap.ts`; no account password stored — the human re-login IS the reauth).
  Steps 1-2 hold the D3 mutex for the write and validate-then-backup before overwriting (D2).

## Scope (net-new — server-side OAuth rotation does NOT exist today)

- The detached cascade runner (rotate/refresh/reauth) + probe-validate + validate-then-backup.
- Keychain read/write via the daemon's tested access path; the machine-wide write mutex acquire/
  release ordering shared with `#N`.
- The `next_action` computation feeding [[DXJZM3BW]]'s `status` (e.g. `ok | rotating | reauth-needed`).
- The `/login` REAUTH nudge (reuse `lib/setup-bootstrap.ts` presence channel).

## Open issue this NPT must honor (likely spawns an EHT)

- **janitor#82** — the oauth_rotator's keychain reads of `Claude Code-credentials` RE-PROMPT
  after every access (a login-keychain inheritance defect). This manager must NOT inherit that
  behavior; if fixing it cleanly needs a separate change, register it as an EHT of this NPT
  (sibling under [[KCRMSNL7]], depth-1 — NOT a child of this file).

## Verification

- The cascade never surfaces token material in any log/transcript (grep the detached process
  output + the `status` verb for token-shaped strings — must be clean).
- Concurrent-write test: the server and a simulated `#N` holder cannot both write (mutex proven
  mutually exclusive, not merely unlikely).
- ROTATE→REFRESH escalation fires only on the specific failure reason; REAUTH surfaces the nudge
  and stops (never automates re-auth with stored material).
- validate-then-backup: a failed probe never overwrites the last-known-good.

## Approval log

- 2026-07-16T19:21:48+0200 — **MANDATE (mandated-by: user).** The USER mandated the Family-A
  absorption "including the oauth key rotations" and signed off [[TRDD-H24DF6ZC]] D1-D4, which
  explicitly UNBLOCKED this NPT (#2 OAuth manager). Authored directly as `planned`; no approval
  round-trip — the issuer's authority (user) meets the floor (`min-approval-requirement: user`).
