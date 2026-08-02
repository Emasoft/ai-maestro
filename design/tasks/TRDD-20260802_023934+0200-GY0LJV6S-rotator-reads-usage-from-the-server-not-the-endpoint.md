---
trdd-id: GY0LJV6S
title: The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T02:39:34+0200
updated: 2026-08-02T14:05:06+0200
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
blocked-by: []
release-via: none
labels: [oauth, rotator, statusline, continuity, incident-followup]
---

# The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

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

- [ ] REFUSED AS WRITTEN (see the ⛔ correction) — restated: `tick.ts:490` gains a statusline DISJUNCT into `near`; the endpoint read stays, because `sc` (model-scoped, JI7F1236) and `liveStatus` are endpoint-only
- [ ] candidate reads at `:496`/`:509` unchanged, and documented as structurally endpoint-only
- [ ] ingest stamps the live fingerprint; the rotator rejects non-live-stamped and pre-switch reports
- [ ] an at/over-threshold ingest triggers `autoRotate` immediately; the 60 s timer remains the floor
- [ ] the drain-guard: no expiry-only rotation off a low-usage account onto the last healthy slot
- [~] tests + at least 2 neuters recorded BY NAME; `tsc` 0 — DONE for the selection function (20 tests, 3 neuters, b481b26b/2816405b); the wiring at `tick.ts:490` still owes its own

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
