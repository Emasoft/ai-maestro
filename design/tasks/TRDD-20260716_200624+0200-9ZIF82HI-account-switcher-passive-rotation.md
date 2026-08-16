---
trdd-id: 9ZIF82HI
title: Account switcher — passive rotation to a fresh account/token on 429 / dead-refresh / network interruption
column: blocked
pre-block-column: planned
created: 2026-07-16T20:06:24+0200
updated: 2026-08-16T16:40:46+0200
current-owner: ai-maestro
task-type: security
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approval-datetime: 2026-07-16T19:21:48+0200
approved: true
approval-judge: user
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, account-switch, rate-limit, oauth, security, npt, token-touching]
external-refs: [Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: [1GGQ4HWY]
release-via: none
---

# Account switcher — passive rotation to a fresh account/token on 429 / dead-refresh / network interruption

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Token-touching — mandate (user), gate cleared by [[TRDD-H24DF6ZC]] D1-D4.** Blocked on
[[1GGQ4HWY]] (it reuses the same keychain custody + write mutex). **Build to the signed design.**
**NEXT ACTION:** implement the passive switch — on a 429 / dead-refresh / network interruption,
rotate the active credential to a fresh account/token so the NEXT request uses it (the process
never dies — only the turn does, TRDD-1222f06a §9).

## Problem / Goal

When the active account hits a 5h/7d rate-limit window, a dead refresh token, or a network
interruption, the fleet must keep working by switching to a fresh account/token. Claude Code
does NOT exit on rate-limit/API errors — only the current TURN ends (TRDD-1222f06a §9) — so the
switcher does NOT need to resurrect a process; it makes the NEXT API call use a fresh token. That
next call is triggered by the heartbeat/resume machinery ([[CHN16JXZ]] / [[JAU1ES1C]]), not by
this NPT.

## Scope (net-new server-side; passive, not a process-resurrector)

- A pool of ≥2 accounts/tokens in keychain custody (D2 — via [[1GGQ4HWY]]'s `safe_storage`
  slots; metadata index only on disk).
- Detection of the switch triggers: 429 (rate-limit window exhausted), dead refresh
  (rotate+refresh both failed → REAUTH-needed on that account), network interruption.
- **Passive rotation:** mark a healthy account active so the next request uses it; if all
  accounts are windowed, wait out the shortest window (never a busy-loop). Writes go through
  [[1GGQ4HWY]]'s machine-wide write mutex (D3) — the switcher never opens a second write path.
- Feed the switch state into `status.next_action` / `account_healthy` (via [[DXJZM3BW]]).

## Reuse (do not reinvent)

- Credential custody, keychain access, and the write mutex are ALL [[1GGQ4HWY]]'s — this NPT
  only decides WHICH account is active and WHEN to switch. It never invents a second custody or
  lock path.
- The 5-state safe-state model (`lib/session-safe-state.ts`) + the passive-switch pattern from
  TRDD-1222f06a §9 are the substrate.

## Verification

- On a simulated 429 on account A with account B healthy, the next request authenticates as B;
  no token appears in any log.
- All-windowed: the switcher waits the shortest window and resumes, never busy-loops.
- Concurrent-write safety inherited from [[1GGQ4HWY]]'s mutex (no second writer introduced).

## Acceptance

- [ ] `TRDD-1GGQ4HWY` (the OAuth manager it reuses for custody + the write mutex) reaches a
      terminal column, clearing `blocked-by:`.
- [ ] A pool of ≥2 accounts/tokens exists in keychain custody, indexed via 1GGQ4HWY's
      `safe_storage` slots.
- [ ] The switcher detects all three triggers (429, dead-refresh, network interruption) and
      marks a healthy account active without opening a second write path.
- [ ] `status.next_action` / `account_healthy` reflect the switch state (via `TRDD-DXJZM3BW`).
- [ ] Every case listed under `## Verification` above passes: no token in any log, no
      busy-loop when all accounts are windowed, no second writer introduced.

## Approval log

- 2026-07-16T19:21:48+0200 — **MANDATE (mandated-by: user).** Part of the user-mandated Family-A
  absorption ("automatic management of the account in case of api-errors, rate limits, network
  interruptions"); gate cleared by the [[TRDD-H24DF6ZC]] D1-D4 sign-off (#3 account switcher).
  Authored directly as `planned`; issuer authority (user) meets the floor.
