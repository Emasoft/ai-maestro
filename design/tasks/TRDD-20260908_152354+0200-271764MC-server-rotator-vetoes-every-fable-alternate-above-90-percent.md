---
trdd-id: 271764MC
title: Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch
column: dev
created: 2026-09-08T15:23:54+0200
updated: 2026-09-10T02:53:10+0200
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-10

**CODE LANDED `efb6a509`** (2026-09-08 15:40). Boxes 1-4 and 7 closed. Boxes 5 and 6 are open and
BOTH the owner's.

**NOT DEPLOYED — run BOTH `yarn build` AND `pm2 restart`.** The pid is `tsx server.mjs` from
2026-09-05 11:16 and `efb6a509` landed 09-08 15:40, so the process predates the fix. A restart
alone is not enough: the Sep-5 bundle still carries the old default — `ROTATOR_SCOPED_SWITCH_AT",90)`
in `.next/server/chunks/3242.js`, the ONLY file in `.next/server` that matches, so it is the one
copy — and `.next/server/app/api/statusline/ingest/route.js` carries the tick machinery
(`aimaestro.oauth-rotator.lastTickAttemptMs`). So a stale-bundle tick CAN run at 90 beside the
restarted one, conditional only on something POSTing to `/api/statusline/ingest` and `:176`/`:188`
letting it through. Which copy wins on a given beat is unknown and deliberately not analysed here.

*The method behind each fact above — which needles, why, and five rounds of getting it wrong — is
in `fd6ad062` … `25968956`. It is deliberately NOT restated here: this block is read first for
operational state. One measurement was never taken and would settle whether the second-tick hazard
is live or theoretical — does anything actually POST to `/api/statusline/ingest` on this box?*

**IS `AIM_FLEET_MODEL_FALLBACK` ARMED?** If not, the model-fallback sweep lane is dormant —
`fleet-liveness-watchdog.ts:344` gates the sweep on it and `server.mjs` starts the watchdog with
no options — so Change 2 changes nothing observable, and the Problem section's "the fallback
sweep independently declares scoped exhaustion at 90" describes a lane that is not running. The
tick's own 95 (Change 1) is unaffected either way. The owner's to confirm.

**BOX 6 HAS NO RUNTIME SURFACE.** Neither `SAFE_SCOPED` nor `SCOPED_SWITCH_AT_PCT` is ever an
argument or interpolated into a string. Seven sites, the complete set
over a repo-wide sweep of every file type: `tick.ts:107` defines 95 and `model-fallback.ts:169`
defines 97; `tick.ts:56` imports (a plain import, not a re-export); `:276`, `:532`, `:625` compare;
and `model-fallback.ts:212` is the sole ASSIGNMENT, whose local appears exactly once below it —
`input.scopedPct >= threshold` — leaving no room for a logger, a throw, a closure or a write back.
Separately, in BOTH modules every non-comment occurrence of the literals `95` and `97` is a `const`
initializer — `:169`, `:107`, and `tick.ts:90`/`:91`, the ACCOUNT-window trips that merely share
the value 97 — and a number reachable only from a `const` initializer cannot sit inside a template
literal, whatever emitter wraps it. Nothing but these two files calls
`pctEnv('ROTATOR_SCOPED_SWITCH_AT', …)`. So box 6 cannot be settled by
reading a number off the running system, build or no build — it needs the source, or restating as
a behavioural check (94 accepted, 96 vetoed), itself not on demand because the scoped percentages
are consumption-driven.

Two side facts from the same read: the tick is **ENABLED** (`~/.aimaestro/oauth-rotator-tick.enabled`
is PRESENT — tested by exact path, never a `*.flag` glob), and caveat (c) is re-confirmed on the
LIVE pid: `ps eww` shows no pinned `ROTATOR_SCOPED_SWITCH_AT` / `ROTATOR_SCOPED_ACCOUNT_HEADROOM`,
so the new defaults will not be inert.

**The 09-08 numbers quoted on this card were not measured by this session.** The approval log is
the source and carries its own qualifier (box 2's neuters were *not re-run*) — read it there.

NEXT ACTION — **the OWNER's:** lift the hold (box 5) and run **both** `yarn build` and
`pm2 restart` — a restart alone can leave a second tick running at 90 from the stale bundle. The same deploy
also lands TRDD-RE9AVNJF (`5aa945c1`, `48e839b6` touched `tick.ts` and `slots.ts`, the same
runtime chain). Then two calls that are yours and not mine: whether `AIM_FLEET_MODEL_FALLBACK`
is armed (if not, Change 2 is inert and the Problem section overstates the sweep), and how to
settle box 6 given that no runtime surface prints either number.

COLUMN: `dev`, unchanged, and the owner's call. Three drafts of this block argued the column and
each introduced a false or over-read claim; that argument is in git, not here.

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
(d) ~~lib/*.ts is bundled into .next, not live on pm2 restart alone — this fix needs `yarn build` + restart~~ — the conclusion (`yarn build` + restart) survives, but not for this reason: `tick.ts` IS bundled, and what makes the build necessary is a BUNDLED ROUTE running a second tick. The STATE block carries the corrected version. The hold itself is unchanged and still stands (the dispatching session's write-scope constraint: no build/commit/push here).
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
