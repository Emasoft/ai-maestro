---
trdd-id: 9ZIF82HI
status: tasked
title: Account switcher — passive rotation to a fresh account/token on 429 / dead-refresh / network interruption
column: dev
created: 2026-07-16T20:06:24+0200
updated: 2026-09-30T00:09:59+0200
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
blocked-by: []
release-via: none
created-by: ai-maestro
assignee: ai-maestro-hub-session
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

- [x] ~~`TRDD-1GGQ4HWY` reaches a terminal column, clearing `blocked-by:`~~ STRUCK 2026-09-30 — unsatisfiable by construction: 1GGQ4HWY defers Phase F behind THIS card, so it can never go terminal first (the frontmatter half of this same cycle dissolved 2026-08-20). The substance it guarded — custody + one-writer mutex shipped — is proven by the nine-sha check in the 2026-08-20 Approval-log entry (ddec060f…2b325a11; custody = keychain/safe-storage/slots, mutex = tick-lock.ts). Superseded by that evidence. (Second line of the old box, "terminal column, clearing blocked-by:", was the same sentence continued.)

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
- 2026-08-20T19:35:19+0200 — **UNBLOCKED `blocked → planned` (mechanical correction, INTEGRATOR).**
  `blocked-by: [1GGQ4HWY]` was unsatisfiable **by construction**: this card waited for 1GGQ4HWY to
  reach a terminal column, while 1GGQ4HWY's own Approval log (2026-08-04T23:57:41) defers its only
  remaining phase — Phase F, the REAUTH browser tier — *behind this card*. Neither could ever move; a
  cycle in `blocked-by:` is a graph defect, not a park. Held 16 days.
  The substance this card actually waits on (keychain custody + the one-writer mutex) shipped. Proof,
  run 2026-08-20 in the repo root:

      for s in ddec060f 59ebd182 69ce68cb 699e5f06 67650e06 e963487f 45725da7 1e65a9b3 2b325a11; do
        printf "%-10s " "$s"; git cat-file -t "$s" 2>/dev/null || echo MISSING
      done
      # → all nine: commit   (0 MISSING)

      git show --name-only --format="" ddec060f 59ebd182 69ce68cb 699e5f06 67650e06 \
                                      e963487f 45725da7 1e65a9b3 2b325a11 | sort -u | grep -v '\.md$'
      # → lib/oauth-rotator/keychain.ts, safe-storage.ts, slots.ts   (custody)
      #   lib/oauth-rotator/tick-lock.ts                             (one-writer mutex)
      #   + cascade/rotate/live/network/integrity/global-state/server-tick/tick/tick-status
      #   + tests/unit/oauth-rotator-{keychain,cascade,integrity,live}.test.ts

  The design gate was cleared long before: [[TRDD-H24DF6ZC]] `## Approval log`,
  2026-07-16T19:21:48+0200 — *"ALL FOUR (D1-D4) SIGNED OFF by USER — the implement gate is CLEARED.
  The token-touching NPTs under KCRMSNL7 (#2 OAuth manager, #3 account switcher) are UNBLOCKED"* — so
  this card sat parked for 35 days after the authorisation it was waiting for arrived.
  **1GGQ4HWY is deliberately untouched** — its `backburner` is documented and correct; its disposition
  is the ARCHITECT's lane, not this correction's.
2026-09-30T00:1x+0200 — REVIEW FINDINGS DISPOSITIONED (adversarial fork, 5 findings): (1) STRUCK acceptance box 1 — unsatisfiable by construction (1GGQ4HWY defers Phase F behind this card; commit b8db6885), applied. (2) column=dev ahead of survey evidence — ACCEPTED as a soft column lie; stands because the build is the stated assigned intent and the survey is a scoping step, not a gate; will revert to planned if the survey kills the card. (3) GY0LJV6S ai_review-vs-blocked normalization — NOT applied: the card's own 17:53 record keeps it ai_review deliberately (parent matched the card's own record); re-typing its column would contradict the owner's defer wording. (4) assignee drift (ai-maestro-hub-session vs this session) — noted; no gate depends on it; correctable on next touch with a valid identity. (5) survey report path missing HHMMSS — the dispatched prompt's path is cosmetic; the worker writes to that path and it is a gitignored reports/ artifact, not a tracked record.
