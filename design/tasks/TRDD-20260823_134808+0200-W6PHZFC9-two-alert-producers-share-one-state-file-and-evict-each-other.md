---
trdd-id: W6PHZFC9
title: two oauth-rotator alert producers share one active-alerts file and mutually evict each other
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-23T13:48:08+0200
updated: 2026-08-23T13:48:08+0200
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
- **A restart would NOT unblock X4RK1NUW's open box.** Verified by reading the writer, not by
  inference: `lib/oauth-rotator/tick-status.ts:130-139` builds the status payload from
  `{nextAction, reason, stuck, windows}` on the tick result; the string `code` — the only thing
  `1a4b8cdf` changes — appears ZERO times in that file and is used solely at
  `server-tick.ts:226` for `deliver()`. So deploying it changes the alert channel, not
  `reason: refresh-dead`. X4RK1NUW's 48h window is blocked by dead refresh tokens (a credential
  condition), not by the undeployed fix.
- **The restart is the owner's call and its blast radius has shrunk.** The prior session declined
  it citing "~19 peers up"; measured today, `tmux list-sessions` reports **3** (`default`,
  `frank`, `testbot`). It remains disruptive to live PTY streams and is not required by this card.

## Proposed fix

Deferred to the advisor verdict recorded in the Implementation section below. The shape under
consideration is an ownership predicate on `DeliveryDeps` so each caller clears only the codes it
is authoritative for, with the open question being whether the default should preserve today's
clear-everything behaviour (compatible, but leaves the same latent trap for a THIRD caller) or
fail safe.

## Verification

The bug is observable in production state, so the fix is verifiable there as well as in tests:
after the fix, `rotator.log` must stop recording a CLEAR of one producer's code on the other
producer's beat, while a genuinely resolved code must still be cleared by its OWN producer.

## Acceptance

- [ ] Advisor verdict obtained and recorded in `## Implementation`, including its answer on the
      default-ownership question.
- [ ] `deliverAlerts` no longer clears a code the calling producer is not authoritative for.
- [ ] A test pins the cross-producer case: two sequential `deliverAlerts` calls with disjoint
      findings leave BOTH sets outstanding in `active-alerts.json` and emit NO `CLEARED` line.
- [ ] A test pins that a genuine resolve still clears — the SAME producer calling again without a
      previously-live code of its own still drops it and logs `CLEARED` exactly once.
- [ ] Neuter run recorded: reverting the scoping reds exactly the cross-producer test(s) and
      leaves the genuine-resolve test green.
- [ ] Full suite green under `bash scripts/with-node.sh yarn test`, with the pass/fail counts
      recorded here.
- [ ] Orphan-code behaviour is decided and recorded: a code in `active-alerts.json` that NO
      current producer claims must not leak forever.

## Approval log

- 2026-08-23T13:48:08+0200 — MANDATE issued by ai-maestro-00 (min-approval-requirement: none).
  Pre-approved: Tier-0 self-mandate — in-scope bugfix in `lib/`, reversible and local, touching
  no credential material, no `.github/`, no governance file and no public API. No approval
  request was sent.

## Implementation

(pending)
