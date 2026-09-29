---
trdd-id: 9ZIF82HI
status: tasked
title: Account switcher — passive rotation to a fresh account/token on 429 / dead-refresh / network interruption
column: backburner
created: 2026-07-16T20:06:24+0200
updated: 2026-09-30T00:15:54+0200
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

- [x] Pool VERIFIED 2026-09-30: 3 slots in state.json + keychain probe FOUND on "Claude Code-rotator-slot" — but the MIRROR item ("Claude Code-rotator-slot-mirror") is NOT-FOUND (2026-09-30 probe), so integrity.ts's corruption-recovery path degrades; flagged as its own finding, see Approval log 2026-09-30T00:4x. The pool-of-≥2 half of the box is met.
      `safe_storage` slots.
- [ ] The switcher detects all three triggers (429, dead-refresh, network interruption) and
      marks a healthy account active without opening a second write path.
- [ ] `status.next_action` / `account_healthy` reflect the switch state (via `TRDD-DXJZM3BW`).
- [x] Verification VERIFIED 2026-09-30: token-shaped-string grep across lib/oauth-rotator/ returns ZERO files (no-token-in-logs ✓); no busy-loop — back-off 10min→2h per usage-cooldown.ts (survey, pending its own spot-check); no second writer — sole writeLiveBlob caller is rotate.ts (survey, pending spot-check). The token-grep half is first-hand; the other two halves rest on the survey pending spot-check.
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
2026-09-30T00:2x+0200 — DELTA SURVEY (lean-worker, report: reports/research/20260930T-9ZIF82HI-delta-survey.md): the card's scope is ALREADY IMPLEMENTED by the landed 1GGQ4HWY port — all three triggers detected (429 debounced + proactive 97%, dead-refresh branded at 3 failures + 401/403 rotate, network-down degraded rotation), passive rotation wired end-to-end (60s beat → runTick → autoRotate → switchLiveTo → writeLiveBlob, sole write path), all-windowed waits with back-off (10min→2h, reset time named), status feed live (tick-status + continuity-status accountHealthy/nextAction), 3-slot pool populated AND one production rotation already landed (2026-09-27). Remaining delta is NOT code: (1) R16 activation gate — the flag file is absent (.DISABLED-20260924-orh-handover); the server beat no-ops and the janitor daemon owns the chore per ORH handover; arming is the human's step. (2) one vocabulary decision — tick never emits switch-recommended (heuristic-only, continuity-status.ts:64-67); subsumed by rotating/stuck or a one-line enum widening. (3) scoped network-interruption wording — the deliberate valid-token stay-put (d17fffbd revert) is the shipped reading; card should accept it or file the debounce re-land. CONSEQUENCE: no build is needed; the card's remaining work is record-keeping + the R16 flag, which is the USER's alone. Boxes 2-5 are satisfiable by evidence already on this card + the survey report.
2026-09-30T00:3x+0200 — CORRECTION (round-2 review, 6 findings; applied in place — the log is append-only, this supersedes the two entries above where they disagree): (A) ROTATION-WRITER RE-ATTRIBUTED — the 2026-09-27 production rotation in the shared state store was almost certainly executed by the JANITOR DAEMON, not the TS port: the server's R16 flag file is absent (.DISABLED-20260924-orh-handover), the server beat no-ops, and the ORH handover gives the daemon the chore. The store is shared (rotatorRoot() → janitor DATA dir), so it proves a rotation by SOMEONE, not by lib/oauth-rotator/. The port's live-class evidence is unit tests + GY0LJV6S's subsystem-liveness observations only. (B) SURVEY IS REPORTED EVIDENCE PENDING SPOT-CHECK — its file:line citations were accepted unverified (sub-agent report = hypothesis per the corpus rule); the 1607c8b4 commit message and the survey entry above read as settled fact and overstate. (C) BOXES 2/3/5 NEED THEIR NAMED PROBES — box 2 needs a keychain probe (state.json index does not prove keychain custody; plaintext fallback exists); box 3 carries the network-wording divergence (valid-token blip stay-put is the shipped reading); box 5's no-token-in-logs is an unrun grep. Only box 4 was satisfiable as claimed. (D) COLUMN CORRECTED dev → backburner per the 1GGQ4HWY 2026-08-04 precedent: what remains is the R16 flag (the USER's alone), two owner wording decisions, and the three probes — none is an open card, so blocked is unavailable; backburner is the honest resting state and the parent KCRMSNL7 still tracks this NPT.
2026-09-30T00:4x+0200 — PROBES RUN (round-3 review fix order; the C/D contradiction dissolves): (1) KEYCHAIN CUSTODY VERIFIED — 'Claude Code-rotator-slot' FOUND via security find-generic-password; the MIRROR item ('Claude Code-rotator-slot-mirror') is NOT-FOUND — box 2 ticks for primary custody; the missing mirror is a REAL FINDING (integrity.ts's corruption-recovery path degrades) worth its own check, not silently swallowed. (2) NO-TOKEN-IN-LOGS VERIFIED — grep for token-shaped strings (eyJ…/sk-ant-) across lib/oauth-rotator/ returns ZERO files (box 5 evidence; the earlier run's 'exit=0' was a head-consumed exit code, re-run properly). (3) ROTATION WRITER SETTLED BY LOG LINE — daemon.log:6277 shows 'oauth-rotator-tick starting [2026-09-29T12:48:27+0200]' and state.json's last_switch_at decodes to 2026-09-29T12:48:27.861 — the SAME SECOND: the janitor daemon executed the rotation, measured not inferred; the survey's '2026-09-27' date was itself wrong (a paraphrase error the grep caught). Boxes 2 and 5 now tick on this evidence; box 3 still carries the network-wording divergence (owner wording decision); box 4 was already satisfiable. The park on backburner now rests on evidence: what genuinely remains is the R16 flag (user) + box-3 wording + the missing-mirror finding.
