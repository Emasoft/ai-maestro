---
trdd-id: 271764MC
title: Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch
column: dev
created: 2026-09-08T15:23:54+0200
updated: 2026-09-09T17:36:47+0200
current-owner: governance-rules-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-08T15:23:54+0200
priority: 1
---

# Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

**CODE LANDED `efb6a509`** (2026-09-08 15:40). Boxes 1-4 and 7 closed. Boxes 5 and 6 are open and
BOTH the owner's.

NEXT ACTION — **the OWNER's, not this session's:** lift the build/restart hold (box 5; ONE
`yarn build` + `pm2 restart` also deploys TRDD-RE9AVNJF, whose fix is in the same bundle and
equally undeployed), then confirm 95 and 97 (box 6).

**NOT MEASURED BY THIS SESSION.** The 09-08 approval log records the COORDINATOR's own checks
(5 vitest files, 109 passed, `tsc --noEmit` 0 error lines, no `ROTATOR_` pins) and SEPARATELY
flags that box 2's neuters were the WORKER's recorded runs, *not re-run*. Two different
provenance chains — an earlier draft of this block collapsed them and attributed all of it to a
`reports/lean-worker/` file nobody here opened. `pid 24806` describes a process as of 09-08; the
running server may no longer be that pid, which is what leaves caveat (c)'s env question OPEN
rather than settled either way.

**NOT DEPLOYED BY ANY ROUTE THIS CARD RECORDS** — `lib/*.ts` is bundled into `.next` and no build
has run since. So 95/97 is not expected to be live, **but that is an inference, not an
observation**: nothing here greps the compiled chunk or dates `.next` against the commit. An
earlier draft asserted "the running server still vetoes at 90" — withdrawn as over-claimed.

**COLUMN — `dev`, and it is the OWNER's call, not a defect this session is sitting on.**
RE9AVNJF's STATE block lists **`dev` + a note** as its FIRST candidate ("stale, but the drain rule
keeps it in view"); it took `backburner` for itself and explicitly declined to choose a third
time. So `dev` is a WEIGHED option here, not a rejected one.

**Two earlier drafts of this block said otherwise and both were wrong** — the second called `dev`
a "LIVE DEFECT" and "not among the options RE9AVNJF weighs". That was FALSE, and instructively
so: it was read off a `grep` whose keyword list omitted `dev` and whose `head -40` truncated a
118-line block — verified-absent claimed from not-searched-for. A review fork then argued from
that false premise that the card was parked at a rejected option and should move. Corrected
2026-09-09T17:36 by grepping for the word itself.

## Problem

lib/oauth-rotator/tick.ts:521-522 `isSafeAlternate(bfh, bsd, scoped)` vetoes any alternate whose scoped (per-model, Fable) window is `>= SAFE_SCOPED` (l.98, aliased to `SAFE_7D = 90`, l.93), while the rotate-away trip is `SWITCH_AT_SCOPED` (l.97, aliased to `SWITCH_AT_7D = 97`, l.90) — a 7-point gap the account windows keep but the model-scoped window does not. `lib/oauth-rotator/model-fallback.ts:161` `SCOPED_SWITCH_AT_PCT = pctEnv('ROTATOR_SCOPED_SWITCH_AT', 90)` trips the fallback-to-model-switch decision at the SAME 90. Net effect: once Fable sits at 90-96 on every account, every alternate is vetoed as unsafe (below the 97 walk-away trip) AND the fallback sweep independently declares scoped exhaustion at 90 — so the fleet is handed to a model switch (a full cache reset, burning millions of tokens fleet-wide) instead of rotating to whichever account has the most Fable headroom.

## Evidence

- `lib/oauth-rotator/tick.ts:90,93,97,98,521-522`: `SWITCH_AT_7D=97`, `SAFE_7D=90`, `SWITCH_AT_SCOPED = SWITCH_AT_7D`, `SAFE_SCOPED = SAFE_7D`, `isSafeAlternate` uses both. `lib/oauth-rotator/model-fallback.ts:161` `SCOPED_SWITCH_AT_PCT = pctEnv('ROTATOR_SCOPED_SWITCH_AT', 90)`.
- Evidence trace 2026-09-06 05:51-06:08, one account, live: Fable 94 -> 97 -> 98, log line "+SCOPED-WALL … staying put" with "no alternate has headroom on that model" — that morning the account's OWN window was already past the 97 trip, so this fix would NOT have prevented it (the alternates' own scoped percent is not logged, so their state is unknown). Source: reports/lean-worker/20260906_060602+0200-rotator-fable-headroom-trace.md.
- Same trace: "no alternate has headroom on that model" recurs 81 times 03:02-06:02 across all three known accounts (fmuaddib 90-96% Fable at 03:02-04:xx, ipazia 95-97% at 05:2x, emanuele.sabetta 97% at 06:00-06:02) — i.e. the fleet spent hours with every account's Fable window inside or above the unlocked 90-97 band.
- USER ruling (verbatim, quoted without any at-sign): "the ai-maestro chore is buggy and incapable of predicting the fable headroom exhaustion and to rotate to an account with still fable headroom, before resorting to model change (a bad thing that reset all cache, burning millions of tokens across all agents)."
- Janitor session (ai-maestro-janitor-ef, 2026-09-08): prompt caches are per-organization and each subscription account is its own org, so an account rotation cannot reuse the previous account's cache — documented, not measured; a rotation keeps the model, a model switch loses both. This card does not claim a rotation preserves cache.

## Proposed fix

Change 1 — lib/oauth-rotator/tick.ts: give `SAFE_SCOPED` its own literal, `95` (a 2-point hysteresis under the 97 walk-away trip, narrower than the account windows' 7-point margin because a rotation landing on a 97 model-scoped alternate trips away on the very next tick — a ring the 60s dwell floors but does not bound).
Change 2 — lib/oauth-rotator/model-fallback.ts: change `SCOPED_SWITCH_AT_PCT` default from 90 to 97 (equal-trip with tick.ts's walk-away number, so the sweep's verdict and the tick's verdict trip at ONE number — TRDD-IZ6KU37Y is the precedent for two verdicts drifting apart).
Change 3 — tests: isSafeAlternate(94)=true / (95)=false / (96)=false; planModelFallback with scopedPct 94 and 96 both return skip 'no-model-scoped-exhaustion' with no threshold override; scopedPct 97 with account windows under 90 proceeds past the scoped check; the existing TRDD-IZ6KU37Y "walled at 92" fixture is rewritten to the new equal-trip invariant, never deleted.
Quantified at the measured burn rate (~3 points / 9 minutes from the evidence trace): the previously-unlocked 90-95 band is worth ~15 minutes of extra rotation headroom per alternate; the 95-97 hysteresis band is ~6 minutes.

## Caveats

(a) 95 is 5 points more conservative than the janitor's own detector, which treats a window as spent only at >= 100 — deliberate, for the hysteresis reason in Change 1.
(b) UNVERIFIED premise for the USER's ruling: rotating accounts may itself force a prompt-cache cold start (org-scoped caches), in which case rotate-first buys Fable minutes rather than cache — not verified here.
(c) pctEnv reads its env var at module load, so a pinned ROTATOR_SCOPED_SWITCH_AT in the live pm2 environment makes the new default inert until checked against `ps eww` on the running pid.
(d) lib/*.ts is bundled into .next, not live on pm2 restart alone — this fix needs `yarn build` + restart, which is on HOLD per the dispatching session's write-scope constraint (no build/commit/push here).
(e) out of scope: a race with the janitor's separate, manual, Fable-blind rotate_to.py rotation path — named only, not analyzed.

## Acceptance

- [x] fix landed (commit sha recorded here)
- [x] boundary tests (isSafeAlternate 94/95/96, planModelFallback 94/96/97) land, plus two separate neuters recorded per the verification-lessons discipline
- [x] the tick's SCOPED-WALL verdict and the fallback sweep's verdict measured to read the SAME 97 constant (or made to, per Change 2)
- [x] live pm2 environment checked for a pinned ROTATOR_SCOPED_SWITCH_AT / ROTATOR_SCOPED_ACCOUNT_HEADROOM that would make the new default inert
- [ ] built (yarn build) and restarted — currently on HOLD
- [ ] USER confirms the two numbers 95 and 97 once landed — a confirmation of a landed default, not a pre-approval gate
- [x] follow-up filed: log each alternate's own scoped percent on the SCOPED-WALL verdict, so a future trace like the 2026-09-06 evidence can tell whether the fix would have helped

## Approval log

- 2026-09-08T15:23:54+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-08T15:40:27+0200 — fix commit efb6a509 landed on governance-rules (coordinator: the 5 vitest files matching isSafeAlternate or planModelFallback — 109 passed; tsc --noEmit 0 error lines; ROTATOR_ env pins 0 on the shell, the pm2 process pid 24806 and ecosystem.config.js). Box 2's neuters (SAFE_SCOPED back to 90: 1 red; default back to 90: 3 red) are the worker's recorded runs in reports/lean-worker/20260908_153015+0200-r47-rotator-safe-scoped-fix.md, not re-run. Box 3: the SCOPED-WALL verdict (isScopedOnlyWall) guards on SCOPED_SWITCH_AT_PCT, so Change 2 alone re-aligns it and planModelFallback to 97. Residual gap (review fork 27): an alternate at scoped 96-99 still has Fable headroom and is still vetoed — 95 is a hysteresis bar under the 97 trip, not any-headroom-below-100; a USER decision. Janitor bar gap (ai-maestro-janitor-ef, same day): rotate_to's has-Fable-headroom bar stays 90, owner-settled in S2RZHXU7. Not live until yarn build + restart (HOLD).
- 2026-09-09T12:28:10+0200 — takeover by governance-rules-session: assignee ai-maestro-hub-session not alive in ListAgents at 2026-09-09 12:26.
- 2026-09-09T12:28:37+0200 — box 7: follow-up filed as TRDD-8L6GZOSE (Tier 0 self-mandate, column todo). Boxes 5 and 6 remain: 5 is on USER HOLD (no build/restart authorised), 6 is the USER's confirmation of 95/97 once deployed.
