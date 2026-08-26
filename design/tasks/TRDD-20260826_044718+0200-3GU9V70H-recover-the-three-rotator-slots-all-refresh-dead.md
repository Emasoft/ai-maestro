---
trdd-id: 3GU9V70H
title: Recover the three rotator slots — every refresh token is invalid_grant and the cookie leg has not recovered them
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T04:47:18+0200
updated: 2026-08-26T10:39:18+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-26T04:47:18+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
effort: S
labels: [credentials, user-action-required]
external-refs: [Emasoft/ai-maestro#95, TRDD-X4RK1NUW]
---

## Problem

Measured 2026-08-26 04:4x from the rotator's own state (janitor DATA dir
`oauth-rotator/state.json` + `rotator.log`): **all three account slots** carry
`last_refresh_failure: credential-dead` — the OAuth endpoint answered `invalid_grant`
after 233 / 576 / 789 exchange attempts respectively — and every slot's access token
expired 2026-08-11..14 (epoch-ms recomputed via node, not eyeballed). The live Claude Code session works only because the
owner re-logged in by hand; the slot copies are all dead.

The no-human recovery rung (the janitor's cookie leg, which mints a fresh OAuth pair
from a live claude.ai session cookie) has not recovered them: `cookie-leg-stuck` alerts cycle in rotator.log for all three
accounts while `refresh_dead_fp == fp` on every slot. NOTE (review-fork correction):
`cookie-leg-since.json` tracks cannot-self-renew ONSET (supervisor.ts:288), not mint
activity — and it reading `{}` while all three slots are dead is itself an anomaly this
card's diagnosis should explain (the tracker's condition should hold for all three).
This is exactly the state TRDD-X4RK1NUW's 2026-08-30 deadline exists to prevent, and
its 48h clean-window acceptance box cannot start while it stands.

## ⏵ STATE UPDATE — 2026-08-26 ~10:1x-10:3x (janitor report; recovery + alert both then verified FIRST-HAND against the shared store)

**The slots are RECOVERED — by the janitor, via real-Chrome login + capture** (their
`41ccc80f`; their oauth-health `ok`×3 at 09:43/09:56/10:00). **CONFIRMED FIRST-HAND 10:3x from
the shared `state.json` itself** (the review fork correctly objected that the first draft of
this section stated the recovery on the peer's word while our own live alert said the
opposite): all three slots read a FUTURE `expires_at` (7.5/7.7/7.8 h), `via:
slot_capture_browser(full-oauth)`, `fp != refresh_dead_fp`, failure fields ABSENT (dropped by the rewrite — functionally reset). Their root cause: `slot_capture_browser.py` had NO PEP-723 header, so
`uv run --script` installed nothing and every capture died at import — BOTH re-mint legs down
at once, presenting as "refresh dead" for ~19 days. Python-specific; our TS port does not share
the header mechanism, but the CLASS transfers (a re-mint leg that cannot START, masked as a
credential fault). This also answers the `cookie-leg-since.json == {}` anomaly line of inquiry:
the capture leg could not even start.

> **⚠ REFUTED 2026-08-26 10:3x — the "CONFIRMED defect" below was WRONG, my third reversal on
> this thread, and the diagnosis grep settled it in two reads.** `all-maxed` is SET at
> `tick.ts:1285` on `scopedWall && best === null` — "no alternate has headroom ON THAT MODEL" —
> a MODEL-WINDOW verdict, not a credential one. The live decide() line (pm2-out.log 10:33:15)
> measured `Fable=97%` and "no alternate has headroom on that model; staying put … the
> model-fallback lane (/model switch) is the remedy". Fresh credentials do not create Fable
> headroom, so the fresh store and the live alert are BOTH RIGHT about DIFFERENT quantities —
> the same-label-different-noun trap (the alert's phrase "no alternate is healthy" reads as
> credential health and means model headroom; at most a WORDING nit, and its own message body
> already names the real remedy). There is NO onset defect, NOTHING to mirror from A8DPTDOU,
> and the janitor has been told not to mirror one. The paragraph below is kept as the record
> of the wrong conclusion and what refuted it.
>
> PRECISION (fork round 2, candidate loop then read first-hand at tick.ts:1137-1200): `best ===
> null` is AMBIGUOUS in general — the loop `continue`s on unknown usage, so "probe failed" and
> "measured: no headroom" both yield null under the same message. What makes the 10:33 reading
> "measured" rather than "unprobeable": the per-alternate `usageProbe` is PER-BEAT and UNCACHED
> (runs live inside the tick, refresh-and-reprobe on 401/403), the branch requires `networkUp`,
> and the credentials were fresh — so a probe failure at 10:33 has no remaining cause. The
> cached-probe resurrection path does not exist; the wording nit gains a second clause (the
> message should also distinguish probe-failure from measured-no-headroom) for whenever the
> tick is touched.

**~~NEW FINDING — our alert defect is now CONFIRMED~~ (REFUTED above) by two first-hand reads taken minutes apart:**
the shared store shows all three slots FRESH (above) while `active-alerts.json` shows
`rotator-stuck:all-maxed` with `seen: 10`, `lastSeenAt` seconds later — our side is asserting
"no alternate is healthy" against a store that says three are. Precision (fork correction): the
alert LEDGER is live-updating (`seen` climbing); whether the underlying assertion re-derives
from a fresh health probe or replays cached state is exactly the diagnosis, not a premise — the
`seen`-bumper's code has not been read. `rotation-stuck.json` is separately 15.4h stale
(first==last seen 2026-08-25 18:44).

**The janitor's write-set localises the fault to OUR side of the seam** (their third message):
between 09:40-10:05 their capture wrote ONLY `state.json` (+bak/sha256), `rotator.log`,
`cookie-leg-since.json`, `capture-consent.png` — NOT `active-alerts.json`, and no TS-side
store. So the diagnosis question is: WHICH store does our alternate-health predicate READ? If
it reads a TS-side per-slot failure cache rather than `state.json`'s slot fields, no external
re-mint can EVER clear it — a structural mirror break needing an INVALIDATION fix at onset,
not a clear-predicate gate (their A8DPTDOU was a wrong CLEAR; ours is a wrong ONSET — opposite
directions, different fixes). `amp-service.ts:931`'s same-named `expires_at` was examined: AMP
message-envelope TTL, unrelated to the slot schema.

**NEXT ACTION:** (1) RESOLVED by the refutation above — no diagnosis remains; the residual is a
WORDING nit ("no alternate is healthy" should say "no alternate has model headroom") worth one
line if the tick is ever touched. ~~diagnose why~~ (original text kept:) diagnose why the tick's alternate-health view lags an external re-mint
(candidate: cooldown/failure store never cleared by fresh slot fp) and whether the next natural
tick heals it — PRESCRIPTION SUPERSEDED IN PART by the write-set section above: if the
predicate reads a TS-side cache, the fix is INVALIDATION at onset, NOT the A8DPTDOU
clear-gate mirror this line originally prescribed (run
`grep -n -A15 surveyAlternates lib/oauth-rotator/tick.ts` as the diagnosis first step —
it decides which); (2) the janitor's check 1:
prove OUR capture/re-mint leg can EXECUTE end-to-end (a can-it-start dry-run, not a credential
check) — TRDD-CVQJNW3A's `driveConsent` has never run against the real consent page, so this is
the same gap they had; owner-gated per that card. (3) Durability: do NOT quote "a month" —
janitor data shows refresh chains survived 6-19 days per account before `invalid_grant`.

## What recovery looks like (in order of preference)

1. **Cookie leg (no human):** verify the janitor's cookie layer holds live claude.ai
   cookies for the three accounts and diagnose why the slots stay dead — including
   why `cookie-leg-since.json` reads `{}` when its own tracker condition should hold
   for all three (supervisor.ts:288). The cookie layer lives in the
   JANITOR's keychain — invisible from the server process, so this half is a
   janitor-side check, coordinated via ai-maestro#95.
2. **Human re-login:** the owner runs `/janitor-refresh-cc-logins` (or per-account
   browser capture) to re-mint the three slots.

## Acceptance

- [x] All three slots in `state.json` show a fresh `fp` with `refresh_failures` reset and a
      future `expires_at` — VERIFIED FIRST-HAND 2026-08-26 10:3x: expires in 7.5/7.7/7.8 h,
      `fp != refresh_dead_fp`, failure fields ABSENT (dropped by the rewrite — functionally reset), `via: slot_capture_browser(full-oauth)`
      (re-minted by the JANITOR, their `41ccc80f`; the measurement is ours, from the store)
- [ ] `oauth-rotator-tick-status.json` reads a non-`reauth-needed` verdict across two consecutive beats
- [ ] Cause of the cookie leg's inaction recorded (here or on ai-maestro#95) — "it minted" or "why it could not"

## Units-hazard check on the shared slot schema (janitor coordination)

**Units-hazard check (janitor's second message, measured 10:2x):** our TS WRITES ms
unconditionally (network.ts:454 `(Date.now()/1000 + expires_in) * 1000`; slots.ts:377 and
tick.ts:712/924 pass ms through) and READS with the SAME >1e12 magnitude heuristic
(slots.ts:150 — its comment says 'matching rotator.py's heuristic' — and supervisor.ts:440-443,
which also accepts BOTH spellings expiresAt/expires_at). So the two daemons are behaviorally
mirrored today: both write ms, both tolerate either on read, and both share the same
guess-dont-fail weakness the janitor proposes to close. Their proposal (pin ms in the shared
schema, fail loudly out-of-range) is a JOINT schema change — coordinate via ai-maestro#95,
change both sides together or not at all. Also on their list to diff jointly: captured_at,
fp/refresh_dead_fp derivation, via, last_switch_at (seconds on their side — the file mixes
units across FIELDS already, which is the strongest argument for pinning).

## Approval log

- 2026-08-26T04:47:18+0200 — MANDATE (self, min-approval-requirement: none).
