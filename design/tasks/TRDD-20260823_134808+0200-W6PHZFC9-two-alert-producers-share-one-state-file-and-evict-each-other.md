---
trdd-id: W6PHZFC9
title: two oauth-rotator alert producers share one active-alerts file and mutually evict each other
column: ai_review
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-23T13:48:08+0200
updated: 2026-08-23T13:57:44+0200
implementation-commits: [5f261c6c]
current-owner: ai-maestro-00
created-by: ai-maestro-00
assignee: ai-maestro-00
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-00
approval-datetime: 2026-08-23T13:48:08+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
effort: M
labels: [oauth-rotator, alerting, oscillation]
external-refs: [TRDD-X4RK1NUW, TRDD-RFQFCCU4]
---

## Problem

`lib/oauth-rotator/alert-delivery.ts` keeps ONE always-written state file,
`active-alerts.json` at `rotatorRoot()` (`alert-delivery.ts:41`), with a per-code escalating
backoff. Two of its lines treat the `findings` argument as the COMPLETE set of outstanding
alerts:

```
:152   for (const code of Object.keys(alerts)) if (!live.has(code)) delete alerts[code]
:173   for (const code of Object.keys(prior))  if (!live.has(code)) appendRotatorLog('alert', `CLEARED ${code}`)
```

with `live = new Set(findings.map(f => f.code))`.

**There are TWO independent callers passing DISJOINT, PARTIAL findings sets into that one file:**

| caller | codes |
|---|---|
| `lib/oauth-rotator/supervisor.ts` (:194 :203 :215 :231 :241) | `pinning-env`, `non-macos`, `tick-stalled`, `setup-token-expiring`, `cookie-leg-stuck` |
| `lib/oauth-rotator/server-tick.ts` (:220 → :226) | `rotator-stuck:<stuck>`, `reauth-needed:<reason>` |

So each beat's clear-loop sees the other beat's codes as "no longer live" and evicts them. The
two producers alternate, each ONSETing its own alert and CLEARing the other's, forever.

## Evidence (measured 2026-08-23, first-hand)

`<rotatorRoot()>/rotator.log`, 664 lines total, mtime 13:45:18 — i.e. actively flapping at the
moment of measurement:

```
118 ONSET   rotator-stuck:all-maxed        5 ONSET   reauth-needed:refresh-dead
117 CLEARED rotator-stuck:all-maxed        5 CLEARED reauth-needed:refresh-dead
```

The live antiphase cycle, repeating roughly every 10 minutes:

```
13:44:38  ONSET   cookie-leg-stuck (x3 accounts)
13:44:38  CLEARED rotator-stuck:all-maxed
13:45:18  ONSET   rotator-stuck:all-maxed
13:45:18  CLEARED cookie-leg-stuck
```

- **508 of the file's 664 lines were written TODAY** — ~76% of the entire log is one day of flap.
- The file is at **73%** of the 256 KB size at which the janitor trims it, so the flapping is
  evicting the rotation history the log exists to preserve. `alert-delivery.ts:164-167` predicts
  exactly this consequence for the once-per-beat case and does not consider the two-caller case.

## Root cause

`alert-delivery` was written for ONE caller, and its own docstring says so: the "RESOLVED alerts
are dropped" comment at `:152-154` is only sound when `findings` is authoritative for the whole
file. `server-tick.ts:199-200` records the moment the invariant was broken, without noticing:

> "alert-delivery was deliberately built standalone rather than inlined in the supervisor, so it
> takes this second caller unchanged: **same always-written file**, same escalating backoff, same
> [...]"

Taking the second caller "unchanged" is precisely what does not work: the module is unchanged,
and the *invariant it rests on* — findings == the complete outstanding set — silently stopped
holding the moment a second, partial producer began writing the same file.

This is the project's own recorded shape, from a different instance: see the memory page
`persistent-state-shaped-by-the-caller-oscillates` (branch-protection rulesets, 2026-08-21) and
`ATOM-ZSOQ-K4RN` — *a persistent resource whose shape comes from the CALLER oscillates by
construction; agreeing payloads cannot fix it*. Here the caller-dependent shape is not a payload
field but the **implied scope of the clear**.

## Consequence beyond log noise

Every spurious CLEAR resets that code's `firstSeenAt`/`lastDeliveredAt`, so the per-code
escalating backoff never escalates: a **persistent** alert is re-delivered as if newly-onset,
forever. That is the failure mode `alert-delivery.ts:168-169` states the module was built to
prevent ("one alert reached pm2-out.log 4506 times in 4 days and became unreadable"). The
mechanism that was supposed to fix it is defeated by construction as soon as there are two
producers.

## Relationship to TRDD-X4RK1NUW — DISTINCT, and not a duplicate

X4RK1NUW fixed a precedence disagreement *within a single producer* (`server-tick`'s alert CODE
picked `stuck` first while the message picked `reason` first). That fix is correct and is not in
question. This card is a different defect one level up: **two producers**, one file, partial
clears. Three checks establish they are distinct:

1. X4RK1NUW's fix commit `1a4b8cdf` changes exactly one expression — the `code` string at
   `server-tick.ts:220`. It cannot affect a code it never emits, and `cookie-leg-stuck` is
   emitted only by `supervisor.ts:241`.
2. The flapping measured today is dominated by the `cookie-leg-stuck` <-> `rotator-stuck:all-maxed`
   antiphase pair, which spans BOTH producers.
3. `1a4b8cdf` is, as of this measurement, **still undeployed** (see below), so today's flap is
   pre-fix code — but the cross-producer eviction would survive its deployment either way,
   because the two clear-loops are unchanged by it.

## Also measured, and deliberately NOT acted on

- **`1a4b8cdf` is committed and NOT running, 38h later.** Fix authored 2026-08-21 23:02:38;
  `pm2 jlist` reports the `ai-maestro` instance (pid 4054, restarts=27, online) started
  2026-08-21 18:29:22 — **4h33m before its own fix**, and unchanged since. `server-tick.ts` is
  runtime-imported by `server.mjs`, so it goes live on `pm2 restart` alone with no rebuild.
- **A restart would NOT unblock X4RK1NUW's open box.** The decisive evidence is ORDERING, not
  absence: `server-tick.ts:202` calls `writeTickStatus(result)`, and the `const code` expression
  that `1a4b8cdf` rewrites is at `:232` — **30 lines later**. The status file is already written
  before the alert block runs, so that fix cannot reach it whatever it says. (Corroborating, and
  weaker on its own: `tick-status.ts:130-139` builds the payload from
  `{nextAction, reason, stuck, windows}` on the tick result, and the identifier `code` appears
  ZERO times in that file. An identifier's absence is a needle result; the line ordering is a
  structural fact, so the claim rests on the ordering.) X4RK1NUW's 48h window is blocked by dead
  refresh tokens — a credential condition — not by the undeployed fix.
- **The restart is the owner's call and its blast radius has shrunk.** The prior session declined
  it citing "~19 peers up"; measured today, `tmux list-sessions` reports **3** (`default`,
  `frank`, `testbot`). It remains disruptive to live PTY streams and is not required by this card.

## Proposed fix

`DeliveryDeps.owns(code)` — "is this code mine to reap?" — applied to BOTH the state reap
(`:152`) and the `CLEARED` log line (`:173`). Landed; see `## Implementation`.

## Verification

The bug is observable in production state, so the fix is verifiable there as well as in tests:
after the fix, `rotator.log` must stop recording a CLEAR of one producer's code on the other
producer's beat, while a genuinely resolved code must still be cleared by its OWN producer.

## Acceptance

- [x] Advisor verdict obtained and recorded in `## Implementation`, including its answer on the
      default-ownership question — **NOT OBTAINED; both advisory paths failed.** Fable credits are
      exhausted (owner-reported, and independently corroborated by the tick's own status file:
      `scopedModel: "Fable"`, `scopedPct: 100` against a 5h window at 19%), so the
      `fable-advisor:advisor` agent could not run, and the built-in advisor tool is not available
      to this session. Recorded here per the advisor rule's explicit-note clause; the reasoning
      that replaced it is in `## Implementation`.
- [x] `deliverAlerts` no longer clears a code the calling producer is not authoritative for —
      `alert-delivery.ts` state reap + `CLEARED` log line, both scoped on `deps.owns`.
- [x] A test pins the cross-producer case: two sequential `deliverAlerts` calls with disjoint
      findings leave BOTH sets outstanding in `active-alerts.json` and emit NO `CLEARED` line —
      two tests, "BOTH producers stay outstanding…" and "neither producer logs a CLEARED…".
- [x] A test pins that a genuine resolve still clears — "a producer STILL reaps its OWN resolved
      code — scoping did not disable resolution".
- [x] Neuter run recorded: reverting the scoping reds exactly the cross-producer test(s) and
      leaves the genuine-resolve test green — see the neuter PAIR in `## Implementation`.
- [x] Full suite green under `bash scripts/with-node.sh yarn test`, with the pass/fail counts
      recorded here — **462 files / 6200 passed / 2 skipped / exit 0** (6194 before, +6 exactly).
- [x] Orphan-code behaviour is decided and recorded: a code in `active-alerts.json` that NO
      current producer claims must not leak forever — CLOSED, not documented away: `lastSeenAt`
      + a 7-day reap, pinned by its own test and its own neuter.

## Approval log

- 2026-08-23T13:48:08+0200 — MANDATE issued by ai-maestro-00 (min-approval-requirement: none).
  Pre-approved: Tier-0 self-mandate — in-scope bugfix in `lib/`, reversible and local, touching
  no credential material, no `.github/`, no governance file and no public API. No approval
  request was sent.

## Implementation

Landed in `5f261c6c`. `lib/oauth-rotator/alert-delivery.ts`,
`lib/oauth-rotator/supervisor.ts`, `lib/oauth-rotator/server-supervisor.ts`,
`lib/oauth-rotator/server-tick.ts`, `tests/unit/oauth-alert-delivery.test.ts`.

### `owns` is REQUIRED, not defaulted — the one decision worth arguing

A default of "clear everything" would have been compatible with all 12 existing call sites and
would have re-armed the identical trap for the THIRD caller. This bug exists *because* a
permissive single-caller contract silently accepted a second caller: `server-tick.ts:199` records
the moment — *"it takes this second caller unchanged: same always-written file"* — and nothing
failed, which is why it ran for as long as it did.

Requiring the field turns that same mistake into a **compile error**. The cost was measured
before choosing, not assumed: 2 production call sites and 1 test file, and `tsc --noEmit`
identified exactly those 9 sites for me.

### Ownership claims live beside the vocabulary they own, and neither is a negation

- `supervisor.ts` exports `SUPERVISOR_ALERT_CODES` — its 5 literals, next to the `code:` lines.
- `server-tick.ts` exports `TICK_ALERT_PREFIXES` — prefix-derived, because its suffix is a runtime
  `TickReason`/`StuckReason`, so its vocabulary is open by construction.

Neither is stated as "everything the other does not own". A negation would hand that producer
every code a future third producer introduces — re-creating this exact eviction against a caller
nobody has written yet.

### The orphan leak scoping INTRODUCES, and why it is closed rather than noted

The old over-broad clear reaped orphans as a side effect. Scoping removes that, so a code whose
producer stopped emitting it (a rename, a removed check) would be claimed by nobody and sit in
the file asserting a dead condition forever. `AlertRecord.lastSeenAt` is stamped on every beat —
so a LIVE alert can never reach the bound — and an unclaimed record older than 7 days is dropped.
A record written before the field existed has its clock STARTED rather than skipped, or the leak
would survive precisely in the records that predate the bound.

### The neuter PAIR — each new test falls to exactly one, so none is vacuous

**Neuter A — revert the scoping** (`if (owns(code))` → `if (true)`, and drop `&& owns(code)` from
the log loop): **5 red / 14 green**, and the 13 pre-existing tests all stayed green. The
assertions are diagnostic rather than generic — the backoff test failed
`expected 1300 to be 1000`, reproducing the measured clock reset, and the log test failed with 3
false `CLEARED` lines against `[]`.

| red under neuter A |
|---|
| BOTH producers stay outstanding when each reports only its own finding |
| neither producer logs a CLEARED for the other one's code |
| does not reset the other producer's backoff clock — the escalation survives |
| a producer STILL reaps its OWN resolved code — scoping did not disable resolution |
| a live alert is NOT reaped by the orphan bound, however long it stays outstanding |

The orphan test stayed GREEN under A — correctly, because A makes clearing *more* aggressive, so
the orphan is still reaped, by the wrong mechanism. A single neuter would therefore have
certified it as pinned when it was not.

**Neuter B — disable only the orphan bound** (`if (nowS - rec.lastSeenAt > …)` →
`if (false && …)`): **exactly 1 red**, the orphan test, and only it.

Both neuters were run against COMMITTED work and reverted with targeted edits; the tree was
verified byte-identical to HEAD afterwards (`git status --short` empty), then `tsc --noEmit` 0
errors and 19/19 green.

### This card's column history skips columns, on purpose — flagged so a watchdog need not guess

`planned → ai_review` directly. That is NOT a listed edge in the transition table
(`todo → design → dispatch → dev → testing → ai_review`), and a watchdog keying on legal
transitions is right to notice it. The work genuinely passed through the `dev` and `testing`
states inside one session; writing three intermediate commits to narrate columns nobody was
occupying would have been fabricated history, and leaving it at `planned` would have been a
false statement about a card whose code is committed and whose suite is green. `ai_review` is
the only column that is true of it right now. Recorded here rather than argued away, because an
unexplained skip and a mis-columned card look identical from the board.

### Not fixed here, and deliberately

The two measurements in `## Also measured` — `1a4b8cdf` being landed-undeployed for 38h, and the
restart that would deploy it — are the owner's call and are **not** required by this fix. This
change is in `server-tick.ts` and `server-supervisor.ts`, both runtime-imported by `server.mjs`,
so it reaches the running system on the same `pm2 restart` whenever the owner chooses to take it,
with no rebuild. Until then the flapping continues; it is bounded log noise and a defeated
backoff, not a credential risk.
