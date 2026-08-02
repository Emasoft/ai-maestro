---
trdd-id: GY0LJV6S
title: The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook
column: blocked
scope: project
project-id: ai-maestro
created: 2026-08-02T02:39:34+0200
updated: 2026-08-02T15:17:03+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-02T02:39:34+0200
severity: critical
effort: medium
relevant-rules: [R16]
npt: [D8OYFG35, SIV45HOG]
eht: []
implementation-commits: [39bc5cad, 9fed4781, 18deb450]
blocked-by: [D8OYFG35]
pre-block-column: dev
release-via: none
labels: [oauth, rotator, statusline, continuity, incident-followup]
---

# The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02T15:1x+0200

**ALL SIX ACCEPTANCE BOXES ARE CLOSED. Code is complete and unit-verified; it is NOT verified live.**

**`column: blocked`, `blocked-by: [D8OYFG35]`, `pre-block-column: dev` — and the block is REAL, not
bookkeeping.** This card was briefly moved to `testing` on 2026-08-02T15:1x and `trddgrep validate`
correctly refused it (`ORDER-NPT-VIOLATED`: an NPT must be terminal before the parent passes `dev`).
Checking the rule against the facts rather than arguing with the tool: **D8OYFG35's last box is the
USER wiring the statusline hook into `~/.claude/settings.json`, and until that happens NO SNAPSHOTS
EVER ARRIVE** — so the verification step below cannot run at all. The earlier note that D8OYFG35 "is
not a dependency of this card's CODE" is true and was the right call for *building*; it is false for
*verifying*, which is the phase this card is now in.

**NEXT ACTION — blocked on the USER.** Once the hook is wired (D8OYFG35 → terminal), restore to
`dev`, then:

```
bash scripts/with-node.sh yarn build && pm2 restart ai-maestro
```

then verify BY EFFECT, never by `git log`: POST a statusline snapshot and read it back, and confirm
a rotator tick logs the `[statusline …]` fragment. `lib/**` and `app/**` bundle into `.next`, so a
restart alone replays the OLD build — this is the single most repeated trap on this card.

**What landed:** `39bc5cad` (push-trigger), `9fed4781` + `18deb450` (the drain-guard), `4ae89436`
(provenance). 43 tests + 16 measured neuters. Full suite **343 files / 4862 tests**, `tsc` 0.

**SUPERSEDED — do NOT carry forward.** Every one of these was true when written and is now false:

| stale claim, below in this file | the truth |
|---|---|
| "⛔ RE-BLOCKED … DO NOT WIRE `tick.ts:422` YET" | [[SIV45HOG]] CLOSED; and the site was never `:422` — see CALL SITE CORRECTED |
| "wire a statusline DISJUNCT into `near`" (every plan section) | built, REVERTED (`3c9a7493`), and the 200-branch form will NOT return. The statusline TRIGGERS, it does not DECIDE — see ⏭ THE ACTUAL DESIGN |
| "`:422` becomes statusline-fed", "use `fiveHourPct` in place of `util(...)`" | REFUSED on measurement — `sc` and `liveStatus` are endpoint-only. See the ⛔ seam-table correction |
| "the endpoint-unreachable branch is the only open question" | now its own card, [[7FTV9MTY]] (`backburner`) |
| "the ONLY source for candidate headroom is the endpoint" | retired — see the CORRECTION on `agentlenspro --all` |

**Still open, but NOT this card:** [[7FTV9MTY]] (re-land the unreachable branch behind a debounce)
and [[VXFI1BR5]] (the incident's ACTUAL root cause — `switchLiveTo` discards the outgoing working
credential; USER-tier, awaiting the USER).

---

USER directive, verbatim: *"the rotator must get its info from the api of ai-maestro server. and the
api must get the info from the statusline hook of ai-maestro. is that clear? if the statusline reads
98% or more in the 5h or 7d window it must immediately rotate to another account oauth with still
headroom."*

**UNBLOCKED 2026-08-02 10:52 — [[D8OYFG35]] has landed** (`675f5a9f`, `f26e794d`; +`ec157607`
NUL-escape, +`ed688407` interactive guard). `types/statusline.ts`, `lib/statusline-normalize.ts`,
`lib/statusline-store.ts` and all three routes are committed, `tsc` clean, full suite **337 files /
4787 tests green**. D8OYFG35 itself sits at `human_review` because its LAST step is a USER action
(wiring `~/.claude/settings.json`), which is **not** a dependency of this card's code — so waiting on
it would have stalled this card behind a human, not behind an artifact.

**⚠ NOT LIVE YET, and that is not the same as not landed.** `app/` is bundled into `.next`, so the
running server still 404s the statusline routes until `yarn build` + restart. Verify by EFFECT
(POST and read it back), never by `git log`.

**⛔ RE-BLOCKED 2026-08-02 11:05 on [[SIV45HOG]] — DO NOT WIRE `tick.ts:422` YET.**

The 10:52 unblock above was right about D8OYFG35 and wrong about this card being startable. Checking
the precondition instead of assuming it: the ingest **does not stamp an account identity** —
measured, not inferred:

| check | result |
|---|---|
| `grep -rn 'live_fp\|liveFp\|fingerprint'` over `lib/statusline-*.ts`, `types/statusline.ts`, `app/api/statusline/` | **0 hits** |
| `grep -rn 'accountId\|liveEmail\|liveAccount'` over the store + routes | **0 hits** |
| the same grep over D8OYFG35's own card | **0 hits — it was never in its scope** |

`StatuslineSnapshot` is `{ sessionId, capturedAt, source, rateLimits, session, context, cost }`.
There is nowhere for an identity to live. So wiring `:422` today would do **precisely** what the
"payload carries NO account identity" section below warns about: after a switch, reports still
arriving from sessions on the OLD credential get attributed to the NEW live account, the rotator
reads ~98 % on a fresh account and rotates straight back out — **a loop that burns every remaining
account in minutes, unattended, while the log reads like healthy rotation.**

Not a defect in D8OYFG35 (every box it owns is delivered) — a prerequisite nobody owned, now filed as
the NPT [[SIV45HOG]].

## ⏭ THE ACTUAL DESIGN — 2026-08-02T14:3x+0200. Read this first; it supersedes every plan below

**THE STATUSLINE'S JOB IS TO SAY "CHECK NOW", NOT "ROTATE NOW".** That one sentence is what the
whole card was missing, and it dissolves the problem the revert below was forced to solve.

Every previous plan — the original substitution, then my disjunct — tried to make the statusline
**decide**. Both failed on the same rock: the statusline cannot be a decider, because its reading
may describe the PREVIOUS account (the stamp is arrival-time; see the ⛔ block). So stop trying.
Let it **trigger**, and let the endpoint keep deciding:

> an at/over-threshold ingest fires `runOneTick()` → which does its normal endpoint-backed
> `autoRotate` → which rotates only if the endpoint agrees.

**Misattribution becomes harmless BY CONSTRUCTION.** A stale 98% from a session on the old
credential fires a tick; the tick asks the endpoint; the endpoint says 10%; nothing happens. The
cost of being wrong drops from *an account* to *one HTTP call*, bounded by a 60 s floor. No
debounce, no dwell tuning, no admissibility subtleties in the actuating path — the guard
(`admitSnapshot`) still filters the trigger, but its failure mode is now merely a wasted call.

**And it delivers the USER's directive more faithfully than the reverted code did.** *"If the
statusline reads 98% or more … it must immediately rotate"* — the statusline is what makes it
IMMEDIATE (sub-second, on the arriving report, instead of up to 60 s of timer latency); the rotation
itself goes through the one safe, already-tested path. Latency was always the real win here; the
call-volume saving was the part that collided with reality, and it is retired.

**Design report (commissioned, evidence-anchored):**
`reports/gy0ljv6s-push-trigger/20260802_141505+0200-design.md`. Its load-bearing findings:

- **Fire `runOneTick()`, NOT `autoRotate()` / `runTick()`.** The tick LOCK lives in `runOneTick`
  (`server-tick.ts:112`) — `autoRotate` takes none. Calling either inner function makes the route a
  second, unserialized writer into the live credential. Also bypasses the R16 flag gate.
- **`void runOneTick().catch(() => {})` — never `await`.** `runOneTick` already swallows errors, and
  the caller (`aimaestro-statusline-capture.sh`) is detached and discards the response by contract.
  Awaiting holds a request open across the rotator's network I/O.
- **The 60 s floor must be stamped ON ATTEMPT, in `globalThis`, and by `runOneTick` itself** so the
  timer's own beats advance it too. Two traps: `state.last_switch_at` is the WRONG source (written
  only on a *successful* switch — `rotate.ts:44` — so a failing rotation has no backoff at all), and
  a module-level `let` splits across the two module instances in full mode.
- **Use the snapshot already in hand** (`route.ts:129`) with `admitSnapshot` + `isNearLimit(fh, sd,
  null)`. Do NOT call `listStatuslineSnapshots()` — a readdir on a 600/min path is the exact cost
  this is removing.

**Consequence for the reverted branches.** The `liveStatus === 200` disjunct stays dead — it was
unsound and this design does not need it. The endpoint-unreachable branch is now the ONLY open
question, and it is genuinely separate: when the endpoint is down there is no decider to defer to,
so it is the one place the statusline would still have to actuate. Decide it on its own merits
later; it is not on this path.

## ⛔ REVERTED 2026-08-02T14:2x+0200 (`3c9a7493`) — READ THIS BEFORE THE ✅ SECTION BELOW IT

**`d17fffbd` re-opened the burn loop, and THIS CARD HAD WARNED ABOUT IT IN WRITING.** Both wirings
are out. `statuslineNear` stays (pure, 8 tests, 3 neuters, **no caller**) — the same state
`admitSnapshot` was in before, deliberately.

The warning I wired straight past is two sections down, "two things it does NOT do":

> *"A session still on the OLD credential immediately after a switch is stamped with the NEW
> fingerprint and **passes both guards**."*  … and running sessions *"hold their token in memory,
> so they are not retro-fixed"*.

Compose them: after A→B, every still-live session on A keeps reporting **A's ~98%** for as long as
it runs. Ingest stamps those with **B's** fp, post-switch — so `admitSnapshot` admits every one. The
disjunct then reads 98% on a fresh B and rotates straight back out, per account, until the fleet is
spent, with the log reading like healthy rotation. **Near-deterministic, not residual.** Found by
adversarial review (Fable advisor); verified first-hand against the card and the code before acting.

**`MIN_DWELL_S` is not the backstop it looks like.** `last_switch_at` is written ONLY inside
`switchLiveTo` (`rotate.ts:44`), so a rotation that finds no candidate leaves the dwell untouched
and the next tick retries immediately. There is no backoff on the failure path at all.

**Two reverts, two DIFFERENT judgements — do not collapse them:**

| branch | verdict | re-landable? |
|---|---|---|
| `liveStatus === 200` | **UNSOUND.** `usageRequest` with the live token just returned ground truth for the exact two windows the statusline carries, so on disagreement the statusline is wrong BY CONSTRUCTION. It can never add a TRUE reason here. | **No.** No debounce fixes a source that cannot legitimately override the answer in hand. |
| endpoint **unreachable** | Genuinely ADDITIVE (the endpoint said nothing) — but inherits the same misattribution, and worse: every candidate is unevaluable too, so the rotation goes out blind on the `degraded` path and can walk the whole fleet a dwell at a time rather than stalling on one account. | **Yes**, with `sl.near` sustained across ≥2 consecutive ticks (mirror `LIVE_429_DEBOUNCE`) **plus** a statusline-specific dwell ≫ `MIN_DWELL_S`. |

**What survived, and why it matters more than the code did:** the LOG LINE. The statusline reading
is still recorded on every tick, it simply does not actuate — so `5h=10% … [statusline 5h=98%
OVER-THRESHOLD]` appears in one line in production, and **the misattribution becomes measurable
before anyone re-lands a debounced version.** That evidence did not exist when I wired this.

The two integration tests that pinned the removed branches are **inverted, not deleted**, each
naming its own reason, so re-adding either wiring turns them red.

**The lesson, because it is bigger than this card:** the card's STATE block contained the exact
sentence that refutes the design, and I read past it while implementing the design. A warning
written in the same document you are working from is not automatically a warning you have *read*.

## ✅ LANDED 2026-08-02T14:0x+0200 — `d17fffbd`, NOW REVERTED — kept for the reasoning, not the verdict

`statuslineNear(state, deps)` in `lib/oauth-rotator/tick.ts` is wired at **two** call sites:

1. the `liveStatus === 200` branch — `near = isNearLimit(fh, sd, sc) || liveExpired || sl.near`.
   A pure disjunct; nothing about the endpoint path changed.
2. **a NEW branch**: endpoint UNREACHABLE **and** statusline at/over threshold ⇒ rotate. That case
   previously returned "staying put" unconditionally, which was right while the endpoint was the
   only source (refusing to act on no data is the fail-safe) and is the wrong answer once a second,
   independent source says the account is spent. The asymmetry survives: the statusline can move us
   OFF a maxed account and can never talk us into staying on one.

It calls `isNearLimit` rather than re-comparing to `SWITCH_AT_5H`, so ONE threshold predicate
exists, not two that drift. `scoped: null` is that function's documented contract, exactly true of
a source that structurally cannot see the scoped windows. Fail-soft throughout: an unreadable store
yields `false`, i.e. today's behaviour.

**Two things worth carrying forward, both found by measurement rather than reasoning:**
- The read must happen **after** the endpoint call, because `state` only then carries the
  reconciled `live_fp`/`last_switch_at` the guard compares against. Judged against a
  pre-reconciliation state a snapshot is admitted relative to the *wrong account*.
- `deps.now()` is **seconds**, `capturedAt` is **milliseconds**, converted at the seam. Unconverted
  it is wrong by 1000× in the direction that makes every sample look *infinitely fresh* — which is
  how that fix's own first test came out VACUOUS (it asserted "a fresh maxed sample trips", true
  either way). The neuter reddened a different test than predicted and that is what exposed it. The
  discriminating fixture is a fresh/stale PAIR; see the test file's neuter record.

**Still open on this card:** the push-trigger (box 4 — what makes the USER's word *"immediately"*
true; the disjunct alone still waits for the 60 s tick), the drain-guard (box 5), and integration
coverage of the two branches above.

## ⛔ THE SEAM TABLE BELOW IS WRONG — corrected 2026-08-02T14:1x+0200, read this first

**The statusline can only ever ADD a reason to rotate. It can never remove one, and it can never
replace the endpoint read.** The seam table further down says `:422` (now `:490`) *becomes*
"statusline-fed"; the NEXT ACTION under it said "use `fiveHourPct` in place of
`util(liveData,'five_hour')`". Both were written before the collision below existed, and building
to either would ship a REGRESSION on [[JI7F1236]].

**Measured at the call site, not inferred.** That ONE `usageRequest(liveBlob, netDeps(deps))` at
`:490` supplies **four** things the branch below it consumes, and the statusline can carry exactly
two of them:

| what `:490` yields | consumed by | statusline? |
|---|---|---|
| `fh` = five_hour | `isNearLimit` | ✅ `fiveHourPct` |
| `sd` = seven_day | `isNearLimit` | ✅ `sevenDayPct` |
| `sc` = `worstScopedPercent(liveData)` — the **model-scoped weekly windows** | `isNearLimit`, REQUIRED param | ❌ **endpoint-only** |
| `liveStatus` | the 429 debounce (`:514`), the 401/403 `token REJECTED` branch, `networkUp` | ❌ **has no status at all** |

The scoped half is not a detail: `isNearLimit`'s own docstring says Fable 5 *"has its own weekly
window that appears in NEITHER top-level bucket, so an account can be fully spent on it while 5h/7d
read low"*, and `sc` is a **required** parameter precisely so a caller cannot forget it —
[[JI7F1236]] closed that blindness deliberately. `types/statusline.ts:46` already recorded the same
fact from the other side (*"NOT in the statusline payload … They remain endpoint-only"*). The
knowledge existed; this card's plan simply predates it.

**So "preferred with fallback" is incoherent here** — it is not a choice between two sources of the
same number. It resolves two ways and both are wrong:
- skip the endpoint when the statusline answers ⇒ lose scoped-window detection **and** token-rejection
  detection. A safety card shipping a safety regression.
- call the endpoint anyway ⇒ the ~420-calls/hour saving, which was this card's secondary rationale,
  simply does not exist.

### The shape that IS correct — asymmetric, positive-signal-only

Rotating is the fail-safe direction; *not* rotating is the dangerous one. So:

- **TRIP EARLY (statusline may do this alone).** An admissible reading at/over threshold is a
  *sufficient* reason to rotate. Free, continuous, no endpoint call.
- **CLEAR (endpoint only).** A statusline reading of "5h=10%" does **not** license "not near" — the
  account may be fully spent on Fable 5, or its token already rejected. Only `:490` can say that.

This is not a compromise; it is the same contract `isNearLimit` already states — *"Unknown (null)
usage never trips it — only a positive over-threshold signal rotates."* The statusline is a
positive-signal-only source by its nature, and the asymmetry makes it structurally unable to cause
the loop [[SIV45HOG]] guards against.

**And it still delivers the USER's directive verbatim** — *"if the statusline reads 98% or more in
the 5h or 7d window it must immediately rotate"*. That asks for statusline→rotate. It does not ask
for statusline→replace-the-endpoint; that was this card's own inference, and it is the part that
collides. The latency win (60 s → one assistant message) survives intact via the push-trigger; only
the call-volume saving is retired.

**Concretely, in the `liveStatus === 200` branch:** `near = isNearLimit(fh, sd, sc) || liveExpired`
gains one more disjunct fed by `freshestAdmissibleUsage`. A pure disjunct cannot remove a rotation
reason, leaves `sc` / `liveStatus` / the 429 debounce / the 401-403 branch untouched, and is guarded
by `admitSnapshot` against the stale-attribution loop.

**Consequence for the acceptance boxes:** box 1 ("`:422` reads the live 5h/7d … not the endpoint")
is REFUSED AS WRITTEN and restated below as the disjunct. Box 2 (candidates stay endpoint-only) was
already right and is now right for a second reason.

---

**NEXT ACTION (superseded twice — read this paragraph, not the two above it).** [[SIV45HOG]] is
CLOSED and its guard is now WIRED INTO A CALLABLE SELECTION. `lib/statusline-admissible.ts` exports
`freshestAdmissibleUsage(snapshots, rotator, {now, maxAgeMs})` → `{fiveHourPct, sevenDayPct,
capturedAt}` or **null**, 20 tests + 3 measured neuters (`b481b26b`, `2816405b`). It has NO caller.

The remaining edit is at **`tick.ts:490`** (NOT `:422` — see the CALL SITE CORRECTED section), and
it is deliberately last because it is the one edit that can hurt. **Read the ⛔ correction at the top
of this STATE block first — the shape is a DISJUNCT, not a substitution.** Steps:

1. read the snapshots + rotator state, call `freshestAdmissibleUsage` with
   `maxAgeMs: STATUSLINE_FRESH_MS` (import the constant; do not restate the number — one owner);
2. in the `liveStatus === 200` branch, add one disjunct:
   `near = isNearLimit(fh, sd, sc) || liveExpired || statuslineOverThreshold`;
3. **change NOTHING else** — the endpoint call, `sc`, `liveStatus`, the `:514` 429 debounce and the
   401/403 branch all stay exactly as they are. A pure disjunct cannot remove a rotation reason,
   which is what makes this safe to land in one step;
4. **null contributes nothing** — never `false`-as-a-clearing-signal. Same contract as `isNearLimit`:
   unknown usage never trips it, and here it must never UNTRIP it either;
5. log when the statusline is what tripped it, so the source of a rotation is observable.

The `:514` debounce needs no statusline equivalent under this shape — it exists to stop ONE bad
endpoint sample rotating, and a disjunct that only ever fires on a *genuine* at-threshold reading
guarded by `admitSnapshot` has no bad-sample path to debounce. (That reasoning replaces step 4 of
the previous plan, which assumed a substitution.)

Then `yarn build` + `pm2 restart` and verify by EFFECT — `lib/**` bundles into `.next`, so a restart
alone replays the old build and `git log` proves nothing.

**Still owed after this, and NOT part of it:** the push-trigger (an at/over-threshold ingest calls
`autoRotate` immediately, 60 s timer remaining the floor). That is what delivers the USER's word
*"immediately"*; the disjunct alone still waits for the tick.

For CANDIDATE headroom read the CORRECTION section first — `agentlenspro get_account_status --all`
now covers the non-live accounts and the old "only the endpoint can" claim is retired.

## The incident this comes from (2026-08-02, ~02:26)

Every session on the host stalled at the window limit; the USER had to rotate by hand, and a large
amount of in-flight sub-agent work was lost. **The rotator was not asleep** — its own decision log:

```
02:26  live ipazia 5h=97% 7d=93% ... all paid accounts maxed; waiting for a window to reset
02:28  live ipazia 5h=100% 7d=93% ... all paid accounts maxed
       reauth-needed: 1 alternate slot(s) have a dead refresh — a human must re-login
```

It detected the limit at its 97 % threshold and re-tried every 60 s. It refused to rotate because
every alternate was either maxed or held a DEAD credential, and rotating onto a dead credential
fails every call — refusing was correct.

**So the trigger was never the failure**, and this card alone would not have prevented the incident.
It is still worth building (it removes ~420 endpoint calls/hour and cuts detection latency from 60 s
to one assistant message), but the two things that actually caused the loss are separate:

- the escalation `a human must re-login` was logged **4 506 times over 4 days** into `pm2-out.log`
  with **no delivery channel to the human** — [[RFQFCCU4]], filed separately and the real cause;
- the rotator **rotated away from a nearly-empty account** (`fmuaddib`, 5h=9 % 7d=38 %) purely
  because its token was expiring, draining its own escape hatch — see the drain-guard note below.

Both are recorded here so the next reader does not mistake this card for the fix.

## The seam — which reads move, and which structurally cannot

`usageRequest()` is called at THREE sites in `lib/oauth-rotator/tick.ts`:

| site | what it reads | after this card |
|---|---|---|
| `:422` | the **LIVE** account's 5h/7d | **statusline-fed, via the ai-maestro API.** Free (Claude Code already paid for the number), refreshed on every assistant message. |
| `:496` | a **CANDIDATE** alternate's usage | **stays `/api/oauth/usage`** — see below |
| `:509` | the same candidate after a refresh | **stays `/api/oauth/usage`** |

**Why the candidates cannot come from the statusline, and this is not a shortcut.** The statusline is
Claude Code's feed for the session that is RUNNING. An account that is not live is not running, so it
emits no statusline. "Rotate to another account **with headroom**" requires the headroom of accounts
that are not live, and the only source for that is the endpoint with each alternate's own token.

The economics still land where the USER wants them: the *continuous* read (the live account, every
few seconds, forever) becomes free, and the endpoint is touched only in the seconds around an actual
rotation — a handful of calls, rarely, instead of ~420/hour.

### CORRECTION (2026-08-02, measured) — "the ONLY source" above is too strong

The sentence *"the only source for that is the endpoint with each alternate's own token"* was true
when this card was written and is **no longer true**. `agentlenspro get_account_status --all` (shipped
in **2.21.0**, the feature requested as `Emasoft/AgentlensPro#8`) reports every account's 5h/7d
windows — including the ones that are NOT live — **reads no credential**, and is assembled entirely
from files, so it *answers with the server down*, which is exactly the state a wedged machine is in.

It does **not** replace the endpoint read, and the difference is the whole point: `--all` returns what
was **OBSERVED while that account was last live**, with an explicit per-window freshness verdict:

| verdict | meaning | usable as |
|---|---|---|
| `fresh` | measured inside the cache TTL | a real number |
| `aged` | past TTL, window not yet reset — utilization only grows | a **LOWER bound** |
| `rolled` | window reset AND this machine was off the account when the new one began | **INFERRED ~0% ⇒ available** |
| `stale` / `unreadable` | reset but activity cannot be excluded / never observed | `null` + a stated reason |

So the correct shape is **pre-filter, then confirm**: use `--all` to rank candidates and eliminate the
provably-full ones (and to *find* the `rolled` ones, which is the signal that pays for the feature —
an account at 91% whose window has since reset is available, not unknown), then read the endpoint for
the ONE candidate about to be actuated. That cuts the rotation-time endpoint calls from "every
candidate" to "one", and gives the rotator a usable answer even when the endpoint is unreachable —
the failure mode that made the 02:26 incident unrecoverable.

**Measured on this host 2026-08-02 10:48, and it argues for doing this:** of three accounts, the LIVE
one (`fmuaddib`) reports `unreadable / never observed`, one reports `stale` + `77% aged`, one
`unreadable`. Two of three have no usable window data at all. A rotator reading only the endpoint is
blind exactly when it needs to choose, and `--all` at least distinguishes *"I cannot see this"* from
*"this has no headroom"* — opposite signals that a missing row renders identically.

**Do NOT read this as "drop the endpoint reads".** `--all` is observational and can be arbitrarily
stale; actuating a rotation on an `aged` lower bound would be exactly the class of decision this card
exists to make safe.

## The payload carries NO account identity — the server must stamp it

Verified against the shipped schema (`downloads_dev/statusline.md`): the payload has `session_id` and
`session_name`, and **nothing identifying the account, org, or user**. Consequences, both mandatory:

1. **Stamp at ingest.** The server records the live account fingerprint (`state.live_fp`) with each
   report, at the moment it arrives.
2. **The rotator MUST ignore any report whose stamp is not the currently-live fingerprint, or whose
   timestamp precedes `last_switch_at`.** Without this, reports still arriving from sessions running
   on the OLD credential are attributed to the NEW live account immediately after a switch — the
   rotator reads ~98 % on a fresh account and rotates straight back out of it. A rotation loop that
   burns every remaining account in minutes.

## Threshold: keep 97, do not raise it to 98

The USER said "98 % or more". `SWITCH_AT_5H` / `SWITCH_AT_7D` are already **97**, which fires
EARLIER and therefore satisfies "at ≥98 it must rotate" strictly. Setting them to 98 would make the
rotator *less* eager than it is today — a regression against the directive's intent. Leave them.

## Push-triggered, not polled — and what "immediately" can mean

`server-tick.ts` runs `autoRotate` on a 60 s timer. This card adds an **ingest-triggered evaluation**:
a report at/over threshold calls the same `autoRotate` path at once. The 60 s timer STAYS as the
floor (a host with no live statusline — a hibernated fleet, a crashed wrapper — must still rotate).

Honest limit on "immediately": a rotation swaps the credential on disk. Sessions already running hold
their token in memory, so they are not retro-fixed; the rotation protects the next turn and every new
session. That is how the rotator already behaves and is not changed here.

## ⏹ THE DRAIN-GUARD — LANDED 2026-08-02T15:0x+0200 (`9fed4781`). Read this before the spec below it

`drainsLastEscapeHatch` in `lib/oauth-rotator/tick.ts` — pure, exported, with ONE call site placed
immediately after the candidate loop so a single guard covers BOTH `switchLiveTo` paths
(drain-first and degraded). It declines exactly one trade: expiry is the SOLE reason, the account is
low-usage, and the rotation would leave zero spares.

**Why refusing is safe — the whole argument, and it is why this is not a stall.** The guard is only
reachable after `usageRequest` returned 200 USING THE LIVE TOKEN, so the token demonstrably works
and `liveExpired` is a PREDICTION. A real failure answers 401 → the token-REJECTED branch, where
`expiryOnly` is never assigned → the rotation happens. A hold costs at most one 60 s tick after a
genuine failure.

**"Low usage" is `isSafeAlternate`**, the rotator's own "would I rotate ONTO this?" test — so no new
constant is invented, and the 90-97 band is deliberately UNPROTECTED (an account at 95 % has no
headroom worth saving).

**Two corrections from adversarial review (Fable advisor), both verified first-hand before acting:**

| correction | why |
|---|---|
| count `candidates` ONLY, never `degraded` | a degraded slot is *not provably dead*, which is not *healthy*, and a paper spare that was dead in fact IS the incident. Counting them licenses the worst shape of all: 0 confirmed + 2 degraded rotates a working 9 %-usage account onto a target whose usage is unknown. **Measured: this is the ONLY thing one fixture in the suite can see** — neuter N2 reds exactly that test and nothing else |
| REPORT the hold, do not swallow it | `surveyAlternates` skips the live account (`:784`) and `keepaliveRefresh` never refreshes it by design (`:469`), so nothing else in the beat can see that the LIVE credential is the dying one. Silent, this renders as `nextAction: ok` + `no action needed` for the state that preceded the lockout — [[RFQFCCU4]]'s defect one branch on. Hence a third `StuckReason`, which `server-tick.ts:185` turns into `rotator-stuck:drain-guard-hold` under alert-delivery's per-code backoff |

**16 tests (15 in `tests/unit/oauth-rotator-drain-guard.test.ts` + the reporting pair), 7 measured
neuters.** Rotator suite 25 files/328 → 26/343; `tsc` 0. **The two neuters that reddened NOTHING are
the most useful records** — both are findings about the CODE, and both are written into the source
rather than left implied:

- **`&& !usageNear` is provably redundant** while `SAFE(90) < SWITCH(97)`: `isNearLimit` trips at
  ≥97, `isSafeAlternate` demands <90, so "near" always implies "no headroom". Kept (it makes the
  variable true to its name and becomes load-bearing if the thresholds are reordered), redundancy
  stated at the assignment.
- **The escape hatch has a SECOND, independent lock.** `httpJson` returns `json: null` for any
  non-2xx (`network.ts:133`), so the usage windows are structurally null on every non-200 branch and
  the null-discipline check declines there regardless of `expiryOnly`. A fixture written to isolate
  the `expiryOnly` half passed, was found to pass for an unrelated reason, and was **deleted rather
  than shipped** — `httpJson` discards the body before `autoRotate` can see it, so that half is
  unpinnable through `autoRotate` by construction.

**Cost, stated rather than glossed:** while the guard holds, each tick still probes every alternate,
where the pre-guard code would have rotated once and gone quiet. Bounded normally (the token is
refreshed, or dies → 401 → rotate); unbounded only for a blob whose `expiresAt` is bogus while the
endpoint keeps returning 200 — correct behaviour on a working token, but it keeps paying the probes.

## ⛔ NOT THE ROOT CAUSE — filed separately as [[VXFI1BR5]] (`design/proposals/`, USER-tier)

The guard makes the incident's *trigger* rare. It does not close the mechanism, and the difference
matters: `switchLiveTo` (`rotate.ts:31-56`) reads the outgoing live blob ONLY to preserve `mcpOAuth`,
then overwrites `claudeAiOauth` — it **never writes the outgoing credential back into the outgoing
account's slot**. So at every rotate-off the rotator is holding a working token for the account it is
leaving and discards it, and that slot keeps whatever stale copy it had (in the incident: 10.9 days
old, 69 failed refreshes). This guard DELAYS rotation to the 401 moment, when the outgoing token is
worthless — so it slightly entrenches the gap. Snapshot-on-rotate-off is its own card, and it is not
free: in-memory sessions still holding the old token can race the same single-use rotating grant.

## Also required — the drain-guard (from the incident)

Do NOT rotate off a low-usage account for LOCAL EXPIRY alone when the target would become the last
healthy slot. On 2026-08-01 the rotator did exactly that twice (01:03 and 10:09), moving off
`fmuaddib` at 39 %/24 % and then 9 %/38 % because its token was expiring — and when the target maxed
out there was no way back, because `fmuaddib`'s stored credential was by then 10.9 days expired with
69 consecutive refresh failures. The account had headroom the whole time; the rotator's *copy of the
key* was dead.

## Verification

- Unit: a stamped report at 98 % on the live fingerprint triggers `autoRotate`; the same report
  stamped with a NON-live fingerprint, or dated before `last_switch_at`, triggers nothing.
  **Neuter: drop the fingerprint check → the post-switch loop test reds.**
- Unit: with the ingest path fed, the live-account `usageRequest` is NOT called; the candidate
  `usageRequest` calls still are. **Neuter: revert `:422` to the endpoint → the "no live endpoint
  read" test reds.**
- Unit: the 60 s timer still rotates when no statusline report has ever arrived (fail-safe floor).
- Contract: a report missing `five_hour`/`seven_day` is treated as UNKNOWN and never as 0 — an
  unknown window must not read as "plenty of headroom".

## Acceptance

- [x] CLOSED AS REFUSED-AS-WRITTEN, not delivered — and the distinction is the point. The original
  wording (`:490` reads the statusline INSTEAD of the endpoint) was refused on measurement: `sc`
  (model-scoped, JI7F1236) and `liveStatus` are endpoint-only, so a substitution ships a safety
  regression. Its restatement as a DISJUNCT was then built (`d17fffbd`) and REVERTED (`3c9a7493`)
  for re-opening the burn loop — see the ⛔ REVERTED section. The 200-branch form is UNSOUND and
  will NOT return. The endpoint-unreachable form IS re-landable and is now its own card,
  [[7FTV9MTY]] (`backburner`), so closing this box buries nothing. **What actually delivers the
  USER's directive is box 4**, the push-trigger: the statusline TRIGGERS a check, it does not DECIDE
- [x] candidate reads at `:496`/`:509` unchanged, and documented as structurally endpoint-only — untouched by `d17fffbd`, and the ⛔ correction now gives a SECOND reason (`sc` + `liveStatus` are endpoint-only for the LIVE account too)
- [x] ingest stamps the live fingerprint; the rotator rejects non-live-stamped and pre-switch reports — SIV45HOG (`1a92aeb0`) + the `statuslineNear` caller (`d17fffbd`)
- [x] DONE (`39bc5cad`) — an at/over-threshold ingest fires `runOneTick()` (NOT `autoRotate` — the lock is one level up) behind a zero-I/O at-threshold pre-check and a globalThis 60 s floor stamped ON ATTEMPT. See the ⏭ ACTUAL DESIGN section; design report in reports/gy0ljv6s-push-trigger/
- [x] DONE (`9fed4781` + the neuter-record follow-up) — the drain-guard: no expiry-only rotation
  off a low-usage account onto the last healthy slot. `drainsLastEscapeHatch` (pure) + ONE call
  site, placed after the candidate loop so it covers BOTH `switchLiveTo` paths. See the
  `## ⏹ THE DRAIN-GUARD` section below for the shape, the two adversarial-review corrections, and
  the two neuters that reddened NOTHING
- [x] DONE — tests + neuters recorded BY NAME; `tsc` 0. **43 tests + 16 measured neuters** across
  `b481b26b`/`2816405b` (the selection function), `d17fffbd` (`statuslineNear`), `9fed4781`/`18deb450`
  (the drain-guard: 15 tests, 7 neuters) and the branch-wiring integration layer (8 tests, 3 neuters).
  The branch wirings ARE now pinned — the tail of `oauth-rotator-statusline-branches.test.ts` had
  claimed "NEUTERS — MEASURED … See the tail" over an EMPTY tail for a day; measured 2026-08-02 and
  written up, including WHY the gap mattered. M1/M2 red DISJOINT single tests, so the two reverts are
  independently guarded; M3 shows the surviving OBSERVABILITY is pinned by 3.
  Full suite **343 files / 4862 tests** green.

## Approval log

- 2026-08-02T02:39:34+0200 — USER MANDATE, issued verbatim (above) after the live incident.
  Authority: USER >= any required approver, so this is authored directly in `design/tasks/`.

## UNBLOCKED 2026-08-02T11:47:52+0200 — read this before wiring `tick.ts:422`

[[SIV45HOG]] landed (`1a92aeb0`, `6dc8a076`): `StatuslineSnapshot.liveFp` is stamped server-side at
ingest and `lib/statusline-admissible.ts::admitSnapshot(snapshot, rotatorState)` returns `null` to
admit or the REASON (`stale-account` | `pre-switch`). Call it before acting on any snapshot; log
the reason so a discard is observable.

**Two things it does NOT do, so this card does not inherit a false premise:**

1. **The stamp is "who was live when it ARRIVED", not "who produced it".** A session still on the
   OLD credential immediately after a switch is stamped with the NEW fingerprint and passes both
   guards. Bounded (the session picks up the new credential or its token expires), and unclosable
   from the server — a session never reveals which credential it holds. Do not describe the guard
   as complete.
2. **Nothing is wired.** `admitSnapshot` has no caller; this card is the caller. It is also
   deliberately pure (it takes the rotator view as a plain object), so wiring means passing
   `loadState()` in, not reaching into the rotator from the predicate.

⚠ **Nothing rotator-side is LIVE until `yarn build` + `pm2 restart`** — `lib/**` bundles into
`.next`, so a restart alone replays the old build. Verify by EFFECT, never by `git log`.

## CALL SITE CORRECTED 2026-08-02T13:40:50+0200 — it is NOT `tick.ts:422`

Measured, because the cited line had rotted and building against it would have edited the wrong
function:

- **`tick.ts:422`** is inside the KEEPALIVE refresh loop — the `refresh_dead_fp` gate that stops
  retrying a credential already classified dead. Nothing to do with usage.
- **The real site is `tick.ts:490`**, inside `autoRotate` (the `ROTATE` section opening at :463,
  whose own docstring says *"Reads quota from /api/oauth/usage"*):

  ```ts
  const [liveStatus, liveData] = await usageRequest(liveBlob, netDeps(deps))
  const fh = util(liveData, 'five_hour')
  ```

`usageRequest` is imported at `:52`. That pair — the request and the `util(...)` extraction — is
what this card replaces with a statusline read gated by
`lib/statusline-admissible.ts::admitSnapshot`.

**Two things to preserve, both already correct at that site and easy to break:**

1. **`:514` debounces a 429** as *"likely a transient usage-endpoint throttle"* before rotating.
   A statusline source has no 429, so the debounce must not simply be deleted — its PURPOSE
   (never rotate on one bad sample) still applies and needs an equivalent.
2. **`:220` records that a null/unknown usage NEVER trips a rotation** — *"only a positive
   over-threshold signal rotates"*. `admitSnapshot` returning a rejection must land in the SAME
   fail-safe branch as unknown usage, not in an error path that does something else. That
   equivalence is the whole reason the guard is safe to wire.

**Do NOT delete the endpoint path in the same change.** Land the statusline read as the preferred
source with the endpoint as fallback, verify by effect, and remove the fallback only once the
statusline path is observed working — the failure mode here is an unattended loop that burns every
account, so a reversible step is worth more than a tidy diff.
