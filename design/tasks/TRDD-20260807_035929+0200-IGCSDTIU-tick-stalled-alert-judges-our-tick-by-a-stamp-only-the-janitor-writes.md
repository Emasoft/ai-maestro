---
trdd-id: IGCSDTIU
title: The tick-stalled alert judges our rotator tick by a stamp only the janitor's rotator writes
column: testing
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-07T03:59:29+0200
updated: 2026-08-07T04:09:20+0200
implementation-commits: [3e3199c0]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-07T03:59:29+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: small
labels: [oauth-rotator, supervisor, alerting, false-positive, owner-ours]
external-refs: []
---

# The `tick-stalled` alert judges our rotator tick by a stamp only the janitor's rotator writes

## Problem

`[oauth-supervisor] ALERT tick-stalled` fires on this host every 10 minutes, forever, saying:

> the 60s rotator tick has not COMPLETED for 368930s (> 600s) while the daemon is alive — the
> tick is hanging or failing; **rotation is effectively OFF**

**Every clause of that is false.** The tick is beating normally. Measured 2026-08-07 over the
3.6 h since the 23:54:34 restart: **214 consecutive minute-spaced** `[oauth-rotator] reauth-repair:`
lines, emitted from `server-tick.ts:232`, which is inside `runOneTick` (:153-:245).

This is not cosmetic. It is the **most important alert channel asserting the exact opposite of the
truth**, indefinitely. In the same minute it fired beside a **real** alert — `reauth-needed`, a
dead refresh only a human login can clear — so the false one trains the reader to discount the
channel that was right. A permanently-red alarm is functionally the same as no alarm.

## Root cause

`supervisor.ts:229-233` measures tick liveness by reading **`tick-completed.ts`** from the rotator
root. Nothing on our side writes that file:

- repo-wide, `tick-completed` appears **only** in the supervisor's own READ (`:233`), its two
  doc comments, three test fixtures, and a memory note — **zero writes**;
- the file's author is the **janitor's** rotator: `oauth_rotator/rotator.py:833` writes
  `ROOT / "tick-completed.ts"`;
- the janitor daemon **exits while a server owns the host**, so on any server-owned host that
  stamp freezes at the moment the daemon last ran. Here: `2026-08-02 20:55:55`.

The supervisor's own inference is **sound** — `server-supervisor.ts:12-17` states it plainly:
*"if the tick is armed but its stamp is stale, the tick is hanging → alert; if the tick is NOT
armed, a stale stamp is expected and no alarm fires."* The tick IS armed and the stamp IS stale,
so the alert is exactly what was specified. **What is violated is the unstated premise that the
beat owner stamps that file.** In the janitor the owner (the daemon's rotator) does. In the server
the owner is `server-tick.ts`'s timer, which does not.

**Proof of attribution, not a plausible story:** the stamp's age at the 03:24:45 alert was
**368930 s**, and the alert claimed **368930**. Exact to the second.

## What is NOT wrong (checked, so nobody re-walks it)

- **`stampChoreRun` works.** It writes `~/.claude/janitor-control/oauth-rotator-tick.last-run.ts`,
  observed **39 s old**. An intermediate hypothesis that it never landed was WRONG — the 12-day-old
  `oauth-rotator-tick.last-run.ts` under the plugin's `global-state/` is a *different file in a
  different directory*, and finding it first is the trap. `~/.claude/janitor-control/` is live and
  shared: the janitor was writing `daemon.heartbeat.ts` into it at 04:02.
- **The write path is not permission-blocked** — same uid (`emanuelesabetta`), dir writable,
  probe-verified.
- **The tick is not gated off.** `stampChoreRun` sits at `:172`, BEFORE the gates, and the commit
  that added it (`01a56c40`, 2026-08-05 06:58) is an ancestor of HEAD; the server booted 08-06
  23:54 and runtime-imports the module from the working tree, so the running code contains it.

## Proposed fix

Give the supervisor a liveness signal whose **owner is the thing it is judging**. Two candidates —
pick one, do not do both:

1. **Read our own beat's stamp when server-side** (preferred). `staleSeconds()` already takes the
   root; give it the server's own attempt stamp instead. Note `stampTickAttempt` (`:142`) writes a
   `globalThis` SYMBOL, not a file, so it is invisible across processes — the durable candidate is
   `choreStampPath('oauth-rotator-tick')`, which is already written unconditionally every beat.
2. **Have the server tick also write `tick-completed.ts`**, preserving the janitor's contract
   (epoch **seconds** — `janitor-chore-stamp.ts:88` records why milliseconds are the one wrong
   answer worse than stale: every stamp lands ~55 000 years in the future and reads permanently
   fresh, so every chore reports healthy forever, including the ones that stopped).

Option 1 keeps one writer per file and is the smaller change. Option 2 risks two processes writing
one file with no lock.

## Verification

- A test that arms the tick, leaves `tick-completed.ts` stale/absent, and asserts **no**
  `tick-stalled` finding — with a **neuter** that reverts the source and reddens exactly it.
- The complementary half must also be pinned: a genuinely hung tick (its own stamp stale while
  armed) still DOES alert. One neuter certifies only half a conditional, and this bug lives
  entirely in the half that was never exercised.
- Live: after the change, no `tick-stalled` line for a full hour while the 60 s beat continues.

## Estimated risk

**LOW.** Alert-only path; `supervisor.ts` heals nothing (`server-supervisor.ts:5`). The failure
mode of a wrong fix is a *missed* stall alert, which is why the second test above is mandatory
rather than optional — silencing a false alarm must not silence the true one.

## Acceptance

- [x] `GatherDeps.tickAgeS` added, defaulting to `tickCompletedAgeS` so the JANITOR path is
      unchanged; the server injects `serverTickAgeS`, reading the stamp its own tick writes.
      DONE `3e3199c0`. Option 1 of the two above was taken — one writer per file, smaller change.
- [x] The ms→s conversion is explicit and commented at the site (`readChoreStamp` returns
      MILLISECONDS, `now` is SECONDS; undivided, every age is ~1000x too large and the alarm
      returns). Pinned by its own assertion, not just by the comment.
- [x] **COMPLEMENTARY neuter pair, observed, with DISJOINT red sets** — recorded verbatim at
      `supervisor.ts`'s `tickCompletedAgeS:` line.
      Revert the fix → 2 red / 27 green, both the SERVER-half tests.
      Break the fallback → 2 red / 27 green, both the JANITOR-half tests — one of them
      **pre-existing**, which is the useful signal: the old path was already covered, so the
      fallback demonstrably preserves it rather than merely claiming to.
- [x] The positive control is INSIDE the behavioural test: a genuinely hung tick still alerts.
      Without it, "no `tick-stalled`" would pass equally against a fix that disabled the alert.
- [x] `tsc --noEmit` 0 lines; 29/29 in `tests/unit/oauth-rotator-supervisor.test.ts`.
- [ ] **LIVE:** no `tick-stalled` line for a full hour while the 60 s beat continues. Requires a
      `pm2 restart ai-maestro` — `server-supervisor.ts` is runtime-imported, so a restart activates
      it with no rebuild, but the running process still carries the pre-fix module. Not run: the
      restart bounces the owner's fleet and is theirs to authorise.

## Approval log

- 2026-08-07T03:59:29+0200 — Authored directly in `design/tasks` as a Tier-0 self-mandate:
  our own code, in-scope, reversible, no baseline/governance/release surface touched. TRDD
  authoring is EXEMPT per the approval defaults (category B). Recorded because the finding was
  verified first-hand — to the second — and a verified defect left only in prose or memory is
  knowledge nobody will ever act on.
