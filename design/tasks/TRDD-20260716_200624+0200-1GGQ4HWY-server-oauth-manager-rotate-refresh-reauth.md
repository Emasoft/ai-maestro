---
trdd-id: 1GGQ4HWY
title: Server OAuth manager — ROTATE/REFRESH/REAUTH cascade, keychain custody, one-writer lock (built to H24DF6ZC)
column: planned
created: 2026-07-16T20:06:24+0200
updated: 2026-07-16T20:49:06+0200
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
SIGNED design; do NOT re-derive it.** [[DXJZM3BW]] is DONE (`03c40474`, testing) — the `status`
verb + the `next_action` seam this manager feeds now exist.

**▶ SPEC IS COMPLETE (H24DF6ZC signed + janitor#100 Q5 exact posture, captured below).** Two
things make this the one NPT to build WITH the owner's awareness, not purely autonomously:
1. **It writes the owner's LIVE Claude credential** (`Claude Code-credentials` keychain item) —
   the single irreversible op in all of Family-A; a bug LOCKS THE OWNER OUT of Claude Code, and
   it cannot be end-to-end tested without risking that live credential.
2. **The one-writer lock needs the janitor's EXACT lock-FILE PATH** (`oauth_rotator/`/`daemon.py`)
   — a CROSS-REPO item to get from the janitor, never guessed (a wrong path lets server + `#N`
   daemon both write the live credential → corruption).

**NEXT ACTION:** obtain the janitor's exact `daemon.flock` path (cross-repo), then implement the
detached model-free cascade to the posture below — non-destructive parts FIRST (lock acquire,
slot READ/index, cascade orchestration, `next_action` into `lib/continuity-status.ts`,
validate-then-backup) and the single `write_live_blob` LAST, with the owner aware before it
first runs live.

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

## The janitor's EXACT tested posture to MATCH (janitor#100 Q5 — the concrete keychain/lock spec)

D3 says "take the daemon's EXACT tested lock; follow its proven keychain-ACCESS path." Here is
that path, from janitor#100 Q5 — the server (Node) must replicate this posture the janitor
daemon (Python) uses, so the two coordinate rather than fight:

- **LIVE credential** = macOS keychain item `service="Claude Code-credentials"`, account=`<macOS
  user>` — **owned and written by Claude Code itself**. The manager CAPTURES it after a
  `/login` and, on rotation, WRITES the chosen slot back into that SAME item (the daemon's
  `write_live_blob`). This is the ONE irreversible write — a bug here corrupts the owner's live
  Claude login and locks them out. It cannot be end-to-end tested without risking the live
  credential, so it needs validate-then-backup (below) and the owner's awareness before it
  first runs live.
- **Slots** (N-subscription backups) = keychain items `service="Claude Code-rotator-slot"`
  **plus** `service="Claude Code-rotator-slot-mirror"` (a redundant copy for corruption
  recovery), encrypted at rest by `safe_storage`: macOS `security add/find-generic-password`,
  Linux libsecret (`secret-tool`), Windows DPAPI. A `state.json` index holds ONLY non-secret
  metadata (emails, expiry, refresh-failure counts) — never token material.
- **Fail-closed:** a present-but-locked/declined keychain REFUSES the write; the caller fails
  closed with NO plaintext fallback. Plaintext is legitimate ONLY on a machine with no secret
  store at all (`NO_BACKEND`), and even then must never silently drop a secret. A
  **keychain-denied latch (circuit breaker)** keeps one transient lock from killing rotation
  permanently.
- **One writer, machine-wide:** the server takes the SAME machine-wide lock the `#N` daemon
  uses (the `daemon.flock` equivalent) — NOT a second lock. The exact lock-FILE PATH lives in
  the janitor's codebase (`oauth_rotator/` / `daemon.py`); it is a **cross-repo coordination
  item** — get it from the janitor (do NOT guess a path, or the two owners could both write the
  live credential and corrupt it). Never touch the OS keychain LOCK state (D3b).
- **Cascade wording match:** the daemon's is ROTATE (swap to a safe alternate slot) → RENEW
  (refresh the slot's OAuth token) → REAUTH (human `/login`). This TRDD's H24DF6ZC cascade
  (ROTATE→REFRESH→REAUTH) is the same; REFRESH == the daemon's RENEW.

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
