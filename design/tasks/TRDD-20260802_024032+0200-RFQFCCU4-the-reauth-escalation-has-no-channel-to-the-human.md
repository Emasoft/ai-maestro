---
trdd-id: RFQFCCU4
title: The rotator's reauth escalation has no channel to the human — it logged 4506 times over 4 days
column: human_review
scope: project
project-id: ai-maestro
created: 2026-08-02T02:40:32+0200
updated: 2026-08-02T13:04:11+0200
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

⚠ **NOT LIVE YET.** `lib/oauth-rotator/*.ts` is bundled into `.next`, so the running server executes
the OLD code until `yarn build` + `pm2 restart`. Verify by EFFECT (drive a stuck/reauth tick and read
`active-alerts.json`), never by `git log` — that exact mistake re-corrupted a ledger on 2026-07-29.

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
- [ ] the message names the specific account and the exact command — TRUE for the supervisor's
      findings (`cookie-leg-stuck` names both); the tick's decision line is COUNTS-ONLY BY RULE
      (`tick.ts:643` "never an email"), so this box cannot be met for tick alerts without either
      relaxing that rule or delivering the identity by a different route. Needs a decision, not code.

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
