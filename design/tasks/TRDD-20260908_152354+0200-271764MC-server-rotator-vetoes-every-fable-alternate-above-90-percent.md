---
trdd-id: 271764MC
title: Server rotator vetoes every Fable alternate above 90 percent and hands the fleet to a model switch
column: dev
created: 2026-09-08T15:23:54+0200
updated: 2026-09-10T05:33:29+0200
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
operational state.*

**THE MISSING MEASUREMENT IS NOW TAKEN, AND IT WENT THE OTHER WAY: THE ROUTE *IS* BEING REACHED
ON THE LIVE STALE-BUNDLE SERVER.** The trigger condition the paragraph above names is **MET**, by
a POSTer that is not the configured statusline and has not been identified.

> **A first draft of this section said the opposite** — "nothing POSTs, the hazard is NOT LIVE",
> attributing the store's writes to the test suite on the strength of a fixture-shaped payload and
> recent mtimes. That was wrong, and the refutation was sitting inside the filenames I had already
> listed: `abc123.json.aim-bak-<stamp>-24895-<counter>` embeds **`process.pid`**
> (`lib/json-io.ts:275`), and **`ps -p 24895` is the live `tsx server.mjs` started Sat Sep 5
> 11:16:27** — the very stale-bundle pid this card is about. A vitest run writes under its own
> short-lived pid, never that one. The inference was "fixture data therefore tests"; the datum was
> a pid.

**WHICH FACT CARRIES THIS, because the two are not equal partners.** The pid alone establishes only
that *the live server process wrote the file* — it does NOT by itself establish that the ROUTE ran.
What closes that gap is the **sole-caller** check: `writeStatuslineSnapshot` has exactly one
non-test caller, `app/api/statusline/ingest/route.ts:130`, and `statuslineStatePath` /
`statuslineStateDir` are referenced nowhere outside `lib/statusline-store.ts` itself (searched
across `app/`, `lib/`, `services/`, `scripts/`, `server.mjs`). The 13 other hits are
`tests/unit/statusline-store.test.ts`, whose ids are `sess-1`/`sess-keys`/`sess-shed`/`rt`/
`corrupt`/`old`/`new`/`real`/`only` — **none is `abc123`**. So: the pid excludes a *different
process*; the sole caller excludes a *different code path*. Both are needed and only the second is
load-bearing.

**The five in-process paths that would break this were enumerated and each refuted** — recorded so
the next reader can attack the claim rather than take it:

| alternative write path | why it does not apply |
|---|---|
| another route importing the store | no other file in `app/`, `lib/`, `services/` references the store's writer or its path helpers |
| a server-side scheduled task (watchdogs, rotator) | would still have to call `writeStatuslineSnapshot`; nothing does |
| the statusline-capture wrapper | it is `scripts/aimaestro-statusline-capture.sh`, a SHELL script — not in-process code, and if it runs at all it POSTs |
| a pty / WebSocket frame handler | same as the scheduled task: no caller exists |
| repair-on-read by a lenient reader | `readJson` contains no `write`/`rename`/`keepBackup`/`unlink` call — its only matches for those words are comments |

**What the writes show — TEN backed-up writes, and whether any were pruned is NOT established.**
Sep 5 12:55/13:04/13:07/19:50/20:00/21:29, Sep 9 14:25, Sep 10 01:16/01:21/01:21, every one under
pid 24895; the live `abc123.json` at Sep 10 01:21 is the CURRENT CONTENT, not an eleventh distinct
write. A draft called this "eleven writes, and that is a FLOOR because the set is AT the cap" —
**both halves wrong.** The prune is `mine.slice(0, max(0, mine.length - BACKUP_KEEP))`
(`lib/json-io.ts:282`, `BACKUP_KEEP = 10` at `:151`), which at length 10 slices nothing: being *at*
the cap is not being *over* it, so ten surviving backups is equally consistent with ten writes and
nothing pruned. What IS true: the oldest surviving backup carries counter **5, not 1**, so at least
one earlier backed-up write went through that module instance — whether it was a statusline write
is not established. The **last** write is Sep 10 01:21 local; nothing since.

**What the counter DOES kill, and it is worth stating because it is the one clean inference here:**
a 3-second statusline refresh would be ~144,000 writes over these five days, with a counter to
match. The observed counter is **23**. No pruning argument is needed — the POSTer is emphatically
not a per-refresh statusline feed, whatever else it is.

**The step-of-2 in the counters is explained, and the explanation corrects a claim a draft of this
block made.** `_atomicWriteCounter` is incremented in FIVE places in `json-io.ts` — once for the
backup name (`:275`) and once for each tmp path (`:472`, `:539`, `:584`) — so one write consumes
**two** counters. Nothing is interleaving. And the counter is **per MODULE INSTANCE, not
process-global** as a draft said: the same pid 24895 carries `~/.claude/settings.json` at counter
**56** stamped Sep 5 13:03 UTC while the statusline set is still at counter **23** on Sep 9 23:21
UTC. A single monotonic counter cannot do that; Next.js bundling gives several copies of the module.
So the counter bounds nothing process-wide and is not relied on above.

**SIDE FINDING, and the most operationally significant thing here: the oauth-rotator subsystem is
DEMONSTRABLY EXECUTING inside pid 24895 — i.e. inside the stale Sep-5 bundle.** The same pid holds
10 backups of `~/.claude/plugins/data/ai-maestro-janitor-ai-maestro-plugins/oauth-rotator/active-alerts.json`
at counters 12423-12441, stamped Sep 10 03:31 through 03:39 UTC — **ten writes in eight minutes**,
i.e. roughly one a minute, right now. **A draft attributed those writes to the `.next` bundle — "`lib/*.ts` is bundled into `.next`, so
it is stale-bundle code running live". WRONG, and backwards on the mechanism.** `server.mjs:1995`
and `:2010` reach the rotator by **runtime `await import('./lib/oauth-rotator/server-tick.ts')` and
`server-supervisor.ts`** — under `tsx` those are transpiled from SOURCE, never served from `.next`.
The project's blanket "`lib/*.ts` is bundled" rule does not hold for a module the server imports
itself, and this same block had already proved the process runs more than one module registry.

**The corrected version is MORE relevant to this card, not less, and it moves the tick question:**

- `server.mjs:1995` starts `startOauthRotatorTick` on its **own timer**, gated on the flag file
  `~/.aimaestro/oauth-rotator-tick.enabled` — which this block already confirms is **PRESENT**. So
  a tick runs in-process on a schedule that owes nothing to the ingest route.
- `tsx` transpiles at IMPORT time, and this process imported at start — **Sep 5 11:16**. So the
  running rotator is Sep-5 SOURCE, which still predates `efb6a509` (Sep 8) and therefore still
  carries the old default. The deploy conclusion is unchanged; only the mechanism was wrong.
- That makes **two** candidate tick paths, not one: the `server.mjs` timer (runtime source) and the
  ingest route (`.next` bundle). The "second tick" this block worries about is the second of those.

**Still NOT established, and the caveat is unchanged:** none of this shows `runOneTick` firing.
`deliverAlerts` is imported by BOTH `server-tick.ts:32` and `server-supervisor.ts:25`, so a write
to `active-alerts.json` does not say which one ran, and the supervisor is documented as alert-only.
What is shown is that the rotator subsystem is not dormant in a process whose code predates the fix.

**What is still NOT established, and must not be read into this:** reaching the route is not the
same as the stale tick FIRING. `app/api/statusline/ingest/route.ts:176` is a gate that can return
early, and nothing here measures whether it did. The hazard's *precondition* moved from unknown to
met; the hazard itself remains unmeasured.

**What survived from the wrong draft** — these checks were sound and are unaffected, and together
they say the POSTer is not the obvious candidate:

- The route's only caller in this repo is `scripts/aimaestro-statusline.sh:162`, and that script
  is **not** the configured statusline: `~/.claude/settings.json` runs
  `agentlenspro statusline --inner '… .venv/bin/python3 ~/.claude/statusline.py'`.
- Neither half of that live chain names the route — `statusline.py` matches `statusline/ingest`
  **0** times, and the AgentlensPro repo (`/opt/homebrew/bin/agentlenspro` →
  `Code/AgentlensPro/standalone/cli.js`) matches it in **0** files against a positive control of
  **1026** files that do mention `statusline`.
- The store (`~/.aimaestro/statusline-state/`, i.e. `statuslineStateDir()`) holds exactly one
  session — `abc123.json` — plus its `.aim-bak-*` copies, every one 665 bytes.

**The payload is fixture-shaped, and that is the open puzzle rather than the answer.**
`sessionId: "abc123"`, `usedPercentage: 23.5`, `resetsAtMs: 1738425600000` (a Feb-2025 constant)
— `abc123` is also the id used across ten-plus files under `tests/`. Fixture-shaped content
arriving *through the live server's own pid* means someone is POSTing test-shaped data at the
running server, not that a test wrote the file directly. Who, is unidentified.

**What this changes for box 5 — LESS than a draft of this block claimed.** That draft said "the
build is now the load-bearing half rather than a precaution". **Retracted:** `yarn build` is
required identically under BOTH readings, because the stale default lives in the bundle whether or
not any route is hit, and this block already said "run BOTH" before either draft. What the finding
actually removes is the *reading under which skipping the build would have been harmless*. That is
worth having and it is not an escalation.

It does add a question that is the owner's: **what is POSTing to `/api/statusline/ingest`?** The
obvious candidates are excluded — **27** `settings*.json` files under `~/agents` and `~/.claude`
were scanned and **none** wires `aimaestro-statusline*`, on top of the configured statusline
chain's 0 hits above.

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
`pm2 restart` — a restart alone can leave a second tick running at 90 from the stale bundle, and
that route is now measured to be REACHED on the live pid (see above), so the build is the
load-bearing half. The same deploy
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
