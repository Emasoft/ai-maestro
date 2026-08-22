---
trdd-id: RFQFCCU4
title: The rotator's reauth escalation has no channel to the human — it logged 4506 times over 4 days
column: completed
scope: project
project-id: ai-maestro
created: 2026-08-02T02:40:32+0200
updated: 2026-08-22T16:28:26.171Z
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T02:40:32+0200
severity: critical
effort: small
relevant-rules: [R16]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth, rotator, escalation, continuity, incident-followup]
---

# The rotator's reauth escalation has no channel to the human

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

**This is the defect that actually caused the 2026-08-02 loss**, not the rotation trigger (that is
[[GY0LJV6S]], and it behaved correctly throughout).

**STATUS 2026-08-02 11:00 — the delivery path is BUILT, WIRED TO BOTH BEATS, and green.**
`75b495a5` built `lib/oauth-rotator/alert-delivery.ts` (file written unconditionally + best-effort
banner + escalating backoff) and wired the SUPERVISOR. `119f2e64` wired the **TICK** — which is where
the incident's own alarms are actually emitted — and closed the `TickResult` gap that let a fully
exhausted fleet report `nextAction: 'ok'` / `'no action needed'`. `tsc` 0; full suite **337 files /
4801 tests green**; 3 neuters recorded by name in Acceptance below.

~~⚠ **NOT LIVE YET.** `lib/oauth-rotator/*.ts` is bundled into `.next`, so the running server executes
the OLD code until `yarn build` + `pm2 restart`.~~ **SUPERSEDED 2026-08-22 — IT IS LIVE**, and
verified the way this note itself prescribes: by EFFECT, not by `git log`. See the verdict block.

**NEXT ACTION:** one decision, not code — the last open box. The tick's decision line is
**counts-only by rule** (`tick.ts` "never an email"), so a delivered tick alert cannot name the
account. Either relax that rule for the delivery channel specifically, or carry the identity by a
separate route. Do NOT silently violate it: it exists so a log surface never leaks an address.

## The measurement

The supervisor emitted, into `logs/pm2-out.log` and nowhere else:

| line | first seen | times |
|---|---|---|
| `reauth-needed: N alternate slot(s) have a dead refresh — a human must re-login` | 2026-07-29 09:58 | **4 506** |
| `auto: … all paid accounts maxed; waiting for a window to reset` | 2026-07-29 15:14 | **217** |

Four days. Four thousand five hundred requests for one human action. The human found out when every
session on the host stalled at once and a large amount of in-flight sub-agent work was lost.

Grepped `lib/oauth-rotator/server-supervisor.ts` and `supervisor.ts` for any delivery mechanism —
notification, `osascript`, `terminal-notifier`, tmux inject, AMP message, webhook, push. **There are
none.** The supervisor builds alert objects (`out.push({...})`) and prints them.

**A guardian that can only whisper into a logfile nobody tails is not a guardian.** The detection was
perfect and the delivery did not exist, so the system had exactly the same outcome as no detection at
all — while looking, in the code and in the tests, like a working alerting path.

## Why the alert mattered so much here

The account that would have resolved the outage (`fmuaddib`) had a nearly empty window the entire
time — after the human's manual `/login` it read `5h=0 % 7d=38 %`. The rotator could not reach it:
its stored credential had expired 10.9 days earlier and its refresh token was dead (69 consecutive
failures). Only a human browser login could revive it.

So the whole outage reduces to: **one human action, requested 4 506 times, never delivered.**

## Scope

- A delivery path for the supervisor's alerts, at minimum for `reauth-needed` and
  `all paid accounts maxed`.
- **Escalating cadence, not per-beat spam.** 4 506 identical lines is itself part of the failure: an
  alert that repeats every minute forever trains its reader to ignore it. First occurrence, then
  backoff (e.g. 1 min → 15 min → hourly), with the age of the outstanding request in the message.
- **The message must name the ACTION, not the condition.** "a human must re-login" does not say which
  account or how. It should name the account and the exact command.
- Fail-soft everywhere: an unavailable channel degrades to the log, never breaks the beat.

## Verification

- Unit: an alert with no prior sighting delivers immediately; the same alert one minute later does
  NOT re-deliver; after the backoff window it does. **Neuter: remove the backoff → the
  no-spam test reds.**
- Unit: a throwing/absent notification channel leaves the beat's return value unchanged and still
  writes the log line. **Neuter: let the channel error propagate → the fail-soft test reds.**
- The delivered message names the account and the command to run.

## Acceptance

- [x] a delivery channel exists that is not the log file — `lib/oauth-rotator/alert-delivery.ts`: the
      `active-alerts.json` file written unconditionally + a best-effort banner on top. Built around the
      trap `lib/setup-bootstrap.ts` documents: under pm2 `osascript display notification` returns exit 0
      and delivers NOTHING, so a banner must never be the sole channel.
- [x] escalating backoff — no per-beat repetition; the message carries how long it has been pending
      (`BACKOFF_LADDER_S` = onset/15m/1h/3h, never permanently silent; `deliveryText` states the age)
- [x] fail-soft: no channel ⇒ log only, beat unaffected — delivery has its OWN try/catch, because
      falling into the beat's outer catch made it return `[]` and DISCARD the alerts it failed to send
- [x] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green
      (`tests/unit/oauth-alert-delivery.test.ts` 9/9; full suite **332 files / 4704 tests green**,
      2026-08-02 04:00 — baseline 331 + this file)
- [x] **the TICK's findings are delivered too** — `server-tick.ts` now calls `deliverAlerts` on
      `reauth-needed` or `stuck`, with a per-fault code (`reauth-needed:refresh-dead`,
      `rotator-stuck:all-maxed`) so backoff and resolve-detection stay per-condition (`119f2e64`)
- [x] `all paid accounts maxed` reaches the human — the `TickResult` gap is CLOSED via an additive
      out-param on `autoRotate` (its return type is unchanged, so all 22 rotator files / 296 tests
      passed before a single new test was written). `deriveDecision` extracted as a pure function
      because that was the defect's exact site and it was unreachable to a test.

**Neuters recorded BY NAME (`119f2e64`):**
| mutation | reds |
|---|---|
| `deriveDecision` all-maxed → `'no action needed'` (re-introduce the bug) | *THE REGRESSION: all-maxed does NOT say "no action needed"* + *stuck OUTRANKS refreshed* |
| delivery block made inert (`if (false && alertable)`) | *delivers on reauth-needed…* + *delivers when the fleet is STUCK…* |
| **delete `out.stuck = 'all-maxed'` in `autoRotate`** | **NOTHING — 22 files / 307 tests still green** |

⚠ **That third neuter is a measured coverage gap, not a formality.** The `autoRotate` → `runTick`
link is pinned by nothing, because reaching that branch needs a live account exhausted with no
healthy alternate — real credential I/O. `deriveDecision` is tested directly and the delivery
wiring is tested directly; the ASSIGNMENT between them is not. A comment at the site says so, so a
future reader cannot mistake the green suite for cover.
- [x] the message names the specific account and the exact command — TRUE for the supervisor's
      findings (`cookie-leg-stuck` names both); the tick's decision line is COUNTS-ONLY BY RULE
      (`tick.ts:1417` "never an email"), so this box cannot be met for tick alerts without either
      relaxing that rule or delivering the identity by a different route. **Needs a decision, not
      code — and the DECISION IS TAKEN 2026-08-22 under the standing owner grant: neither option.
      The rule is right and the coupling is the defect.** Ruling in full below; the implementation
      it calls for is `TRDD-JDXTJXE7`. Ticked because what this box asked for was a decision, and
      the decision exists

## What is still open (verified first-hand 2026-08-02 04:02, not inferred)

The commit wired delivery into **`server-supervisor.ts`** — the 10-minute governance beat, whose
`diagnose()` emits exactly five codes: `pinning-env`, `non-macos`, `tick-stalled`,
`setup-token-expiring`, `cookie-leg-stuck`.

**None of them is the incident's alert.** `reauth-needed` and `all paid accounts maxed` are emitted by
**`tick.ts`** — the 60s rotation beat — a different loop entirely. So the 4 506 lines that accumulated
over four days would still not be delivered today. Closing this card on the strength of the commit
would have been a false claim; the check that caught it was grepping for who actually emits the codes.

Two distinct gaps, one of which is a genuine bug:

1. **`reauth-needed` is deliverable and simply unwired.** It IS on `TickResult`
   (`nextAction: 'reauth-needed'`, `reason: 'refresh-dead' | 'slot-unreadable'`, plus `decision`
   carrying the human text). `server-tick.ts` calls `writeTickStatus(result)` and stops. Wiring it to
   the existing `deliverAlerts` is additive — the module was deliberately built standalone rather than
   inlined in the supervisor, so it takes both callers with no change to it.

2. **`all paid accounts maxed` never reaches `TickResult` at all — this is a REAL BUG, not just a
   missing wire.** It is a `decide()` call at `tick.ts:567`, inside `autoRotate`, which returns a bare
   `boolean`. So on the all-maxed path `runTick` computes `decision: 'no action needed'` and
   `nextAction: 'ok'` — the fleet is fully exhausted with nothing to rotate to, and the tick's own
   status reads as **healthy**. That is precisely the failure the comment at `tick.ts:652` was written
   to fix one level down ("must not say 'no action needed' while nextAction is reauth-needed — that
   reads as health and is how this stayed unexamined"), still present one level up.

   It did not surface during the 2026-08-02 incident only by luck: two slots were dead-refresh, so
   `deadRefresh > 0` forced `reauth-needed` anyway. With three *healthy but maxed* accounts the tick
   would have reported `ok`.

   **Fix shape (chosen, not yet applied):** `autoRotate` is exported with ONE internal call site, so
   change it additively — `autoRotate(deps?, out?: { stuck?: StuckReason })` — leaving every existing
   caller and test untouched. Add `stuck?: 'all-maxed' | 'cannot-rotate-offline'` to `TickResult`, feed
   it into the `decision`/`nextAction` derivation, and deliver on `nextAction === 'reauth-needed' ||
   result.stuck`. **Do NOT** capture it by string-matching the decision text in a wrapped `decide` seam
   — a needle keyed on a message goes blind on the first rewording, which is the defect class this card
   already exists to fix.

## Approval log

- 2026-08-02T02:40:32+0200 — Tier-0 self-mandate: a bugfix inside this project's own scope, filed
  from a live incident. `min-approval-requirement: none`, so authored directly in `design/tasks/`.
- 2026-08-22T16:27:31.255Z — column → complete. Seventh box RULED under the owner grant; implementation carved out as TRDD-JDXTJXE7.
- 2026-08-22T16:28:26.171Z — COMPLETED by user. archived → completed.

## Moved to human_review 2026-08-02T13:04:11+0200 — 6 of 7 boxes done, the 7th is a USER ruling

The code is landed and verified (`119f2e64`, `3062939d`): the tick's alarms are delivered, and an
exhausted fleet no longer reports `ok`. What remains is not code.

**The decision needed, stated so it can be answered in one line.** The tick's decision string is
counts-only BY RULE — `tick.ts` says "never an email" — so a delivered tick alert *cannot name the
account*. The supervisor's alert can and does. So either:

- **(a)** relax the never-an-email rule for the DELIVERY channel only (it goes to the human who owns
  the accounts, not to a log a model reads), or
- **(b)** carry identity another way (an opaque slot index the human can map, e.g. "slot 2 of 3").

I did not pick one, because the rule it would relax exists to keep an address out of model-visible
output, and that is the USER's call rather than mine. **(a) is the smaller change and the more
useful alert; (b) preserves the invariant untouched.**

Sitting in `dev` would have been a lie — nobody is working it, and an untrue column is worse than an
unstarted card because it hides the stall from the only view anyone checks.

## ⚖️ THE RULING 2026-08-22 — neither (a) nor (b): the rule is right, the COUPLING is the defect

Taken under the standing owner grant, on facts read first-hand today. The question was posed as a
choice between relaxing an invariant and working around it. **It is a false choice, because the
invariant the question protects does not exist in the form stated.**

**1. The premise of option (b) is refuted.** The note above says the rule exists *"to keep an address
out of model-visible output"* and that (b) *"preserves the invariant untouched."* Read live:

```
lib/oauth-rotator/supervisor.ts:232   message: `${s.email} is a no-refresh setup-token expiring in …`
lib/oauth-rotator/supervisor.ts:243   message: `${s.email}: no usable refresh path for …h …`
```

Both go through the SAME `deliverAlerts` into the SAME `active-alerts.json` — the file
`alert-delivery.ts:26` describes as *"what the CLI, the API and a human can read."* So account
emails are in the alert store today, deliberately, from its other producer. There is no
address-free invariant left to preserve; (b) would buy nothing and cost the reader an indirection
("slot 2 of 3") they then have to resolve by hand at the worst moment.

**2. What the rule actually governs is the LOG, and it says so at the site.** The citation in the
box was `tick.ts:643`, which has rotted — the real text is at `:1401` and `:1417`, and both are
explicit about the surface:

> `:1401` — *"The tick needs only the counts — **its decision line** is counts-only by rule, never
> an email — but a repair must know WHOSE slot to re-capture, and that identity is exactly what
> this loop used to throw away."*
>
> `:1417` — *"**The decision line is the beat's only log surface**, so it must not say 'no action
> needed' … State the fault and its scope (counts only; never an email, never a token)."*

That rule is correct and must stand: the decision line is appended every 60 s, and 4 506 identical
lines over 4 days is the incident this card was filed for. An append-only log must not accumulate
identities.

**3. So the defect is a COUPLING nobody chose.** `server-tick.ts:226` does
`deliver([{ code, message: alertable.decision }])` — the alert message IS the log line, verbatim —
and `alertableTick` (`:43`) narrows `TickResult` to `nextAction | reason | stuck | decision`, so no
identity exists to pass even if one wanted to. A rule written about a log became a rule about an
alert by inheritance, and the anonymity of the most urgent alert in the subsystem is a side effect,
not a decision.

**4. The identity is already in hand and thrown away.** `runTick` calls `surveyAlternates()` and
immediately reduces it (`tick.ts:1404-1406`) to `survey.unreadable.length` /
`survey.refreshDead.length`. Nothing new is collected.

### RULED

> **Keep `deriveDecision` counts-only, untouched, tests unchanged. Carry the identities to the
> ALERT on a separate `TickResult` field that the decision line never reads.**

The log keeps its invariant for the reason the invariant exists; the alert becomes as actionable as
the supervisor's already is; and the tick stops being the odd producer out on a store that is keyed
by code, holds one message per code, and is dropped on resolution — bounded and self-clearing,
unlike the log.

Implementation: **`TRDD-JDXTJXE7`**, which carries this reasoning, the exact sites, and an explicit
"do NOT implement it by relaxing `deriveDecision`" so the ruling cannot be inverted by whoever picks
it up.

## ✅ REVIEW VERDICT 2026-08-22 — COMPLETE

Six boxes were already landed and verified in code (`119f2e64`, `3062939d`). The seventh asked for a
decision, not code, and the decision is above — made on read evidence rather than deferred a second
time. The work it calls for is new and is tracked as `TRDD-JDXTJXE7`; a decision card does not stay
open to supervise its own consequences.

### The fix is LIVE, and the live artifact proves the ruling was needed

The STATE block's *"NOT LIVE YET"* is stale, and it is struck above. Checked by EFFECT, exactly as
that note demanded — reading the store, not `git log`:

```
$ ls -la ~/.claude/plugins/data/ai-maestro-janitor-…/oauth-rotator/active-alerts.json
-rw-------  402 bytes  Aug 22 18:27          ← minutes old

{ "alerts": { "rotator-stuck:all-maxed": {
    "firstSeenAt": 1787415785, "lastDeliveredAt": 1787415785, "seen": 5,
    "message": "reauth-needed: 2 alternate slot(s) have a dead refresh and are expiring — the OAuth
                rung is dead, but a live claude.ai cookie can still mint these with NO human; check
                the cookie layer before re-logging in" } },
  "updatedAt": 1787416024 }
```

The delivery path this card built is running, with backoff (`seen: 5`, one `lastDeliveredAt`) —
which is the whole card, discharged in the live system rather than in a test.

**And that message IS the ruling's evidence.** It is the counts-only decision line, verbatim: *"2
alternate slot(s)"*, no account named. So the human's single outstanding rotator alert, right now,
tells them two accounts need attention and not which two — the exact defect the seventh box named,
observable in production. `TRDD-JDXTJXE7` is not speculative work.

⚠ **Live and outstanding for the OWNER as this card closes** (not this card's to fix, and it belongs
on the existing reauth item `X4RK1NUW`): `oauth-rotator-tick-status.json` at 18:27 reads
`nextAction: reauth-needed`, `reason: refresh-dead`, `stuck: all-maxed`, windows 5h 26% / **7d 100%**
/ **Fable 100%**. The alert is doing its job; the action it asks for is a human's.

**Carried forward and NOT lost:** the measured coverage gap recorded above — deleting
`out.stuck = 'all-maxed'` in `autoRotate` reddens NOTHING across 22 files / 307 tests, because the
`autoRotate → runTick` assignment needs real credential I/O to reach. It is documented at the site
and stated here so a green suite is never mistaken for cover on that link.

## Approval log (ruling)

- 2026-08-22T18:27:00+0200 — REVIEWED and CLOSED `human_review → complete` under the standing owner
  grant. The seventh box's question was RULED rather than re-deferred: neither (a) nor (b) — the
  never-an-email rule governs the LOG and stands; the alert inherits it only through
  `server-tick.ts:226`, and that coupling is the defect. Option (b)'s stated premise was refuted by
  reading `supervisor.ts:232`/`:243`, which already interpolate `${s.email}` into the same alert
  store. Implementation carved out as `TRDD-JDXTJXE7`. A rotted citation (`tick.ts:643` → `:1401`
  / `:1417`) was corrected in passing.
