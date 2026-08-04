---
trdd-id: ZKQ38TSG
title: Publish per-chore last-run stamps so either side can answer is chore X alive with a stat
column: backburner
created: 2026-08-04T15:40:05+0200
updated: 2026-08-04T15:40:05+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: feature
min-approval-requirement: manager
approved: false
mandate: false
derived: false
priority: 2
severity: medium
effort: medium
release-via: none
labels: [janitor, control-plane, observability, absorbed-duties]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/99, https://github.com/Emasoft/ai-maestro/issues/79, https://github.com/Emasoft/ai-maestro/issues/95]
---

# Publish per-chore last-run stamps so either side can answer "is chore X alive" with a stat

## Problem

The janitor asked for exactly one thing back on `ai-maestro#99` (2026-07-28, USER-directed, and
**unanswered by CORE for 7 days**):

> *"A **per-chore last-run stamp** — a file under `~/.claude/janitor-control/`, or a field in
> `server-liveness.json`. Every open 'is it actually running?' question between us (#95, #79, #100,
> the four missed releases) exists because a report is not an artifact. With a stamp, 'is chore X
> alive?' is a `stat` that either side can answer without asking the other."*

Measured 2026-08-04: **zero** `*.last-run.ts` stamps exist in `~/.claude/janitor-control/`, and
`server-liveness.json` carries only `ts, pid, sha, sha_full, dirty, capabilities`. So the ask is
entirely unmet, and every cross-system liveness question still costs a round-trip through a GitHub
thread.

## ⚠ The location they proposed is one we are FORBIDDEN to write to — deliberately

`lib/janitor-control.ts` opens with a hard rule, and it is not decorative:

> *"**NEVER WRITE.** The path is FIXED and foreign, so an accidental write here ratchets the whole
> fleet into a mode nothing lifts. This module has no writer and exports none. Reads only."*

I was one edit from adding a writer to that module before reading its own header. **Do not do it.**
The rationale is about mode flags (a stray write ratchets a mode nothing lifts) and a `.last-run.ts`
stamp arguably cannot ratchet anything — but the rule as written is absolute, it is the janitor's
own stated hazard, and re-litigating it to save one file is exactly the "route around the rule"
anti-pattern.

**Use the alternative the janitor themselves offered: a field in `server-liveness.json`.** We own
that file, we already write it atomically (`lib/server-liveness.ts:158` `writeServerLiveness`,
tmp+rename, never throws), and they already read it as the §7.2 liveness discriminator. Zero
ownership conflict, zero new contract.

## The design question that must be answered BEFORE building — it decides whether the stamp lies

A naive in-memory registry (chore records its last run; `writeServerLiveness` serialises it each
heartbeat) has a **false-negative window of one full hour after every server restart**: the
absorbed-duty cadence is `ABSORBED_DUTY_INTERVAL_MS = 60 * 60 * 1000`
(`services/auto-update-service.ts:97`), so a freshly restarted server publishes no stamp for that
chore until the first tick lands.

A consumer reading "no stamp" concludes **"chore dead"** — when the truth is "server restarted 4
minutes ago". **That is a signal that reports a fault where none exists**, and it is the same
failure class this entire thread cluster is about (`#97`: a signal that moves on everything except
what it watches manufactures confidence; here: a signal that goes silent for an hour manufactures
alarm). Shipping it would be ironic and actively harmful.

**Options, none free:**

1. **Persist the stamps** across restarts (write them into an owned store, reload at boot). Correct,
   most work.
2. **Publish `started_at` alongside** so a consumer can distinguish "no stamp yet, server is N
   minutes old" from "no stamp, server has been up for hours". Cheap, and it makes the blind window
   *legible* rather than removing it.
3. **Stamp on the FIRST tick at boot** (run the absorbed duty once shortly after start, then hourly).
   Removes the window but changes chore cadence, which is a behavioural change the janitor should
   agree to.

**Option 2 is the smallest honest one and composes with the others.** Do not ship option 0
(in-memory, no `started_at`).

## The stamp must only assert a run that HAPPENED — three skip paths, only one is a run

`runAbsorbedDutyTick` (`services/auto-update-service.ts:273-288`) returns `[]` for three different
reasons and they are NOT equivalent:

| path | did the chore run? |
|---|---|
| `!installedAndArmed` → return `[]` (`:275-280`) | **NO** — the janitor is not this host's consenting owner |
| `withMarketplaceLock` returned `null` → return `[]` (`:283-286`) | **NO** — another process holds the lock |
| body ran, produced no entries | **YES** — it ran and found nothing to do |

Only the third may stamp. Stamping the first two would assert a run that never happened — which is
worse than no stamp, and is precisely the "a report is not an artifact" defect the janitor filed
this to fix.

## Format

Match the janitor's observable convention rather than inventing one: their own
`daemon.heartbeat.ts` contains a **bare epoch** (`1785548215`), not JSON — unlike their `*.flag`
files, which carry a one-line provenance JSON. If the stamps land in `server-liveness.json` this is
moot (it is our JSON), but the field values should be epoch seconds for symmetry with `ts`.

## Scope

The three absorbed duties the server actually runs: `marketplace-refresh`, `version-update`,
`user-plugins-update`. The two OAuth chores (`oauth-rotator-supervisor`, `oauth-rotator-tick`) are
in `SERVER_ABSORBED_TASKS` but gated separately — **not audited here**; an EHT should decide whether
they stamp too before this is called complete.

## Verification

- After a tick, `server-liveness.json` carries a last-run epoch for each of the three chores.
- A tick skipped for `!installedAndArmed` or a held lock leaves the stamps **unchanged** — assert
  this explicitly, with a seeded prior value, or the test cannot tell "not updated" from "never set".
- The restart window is either absent (option 1/3) or legible (option 2) — a test that restarts with
  no tick and asserts a consumer can still distinguish young-server from dead-chore.
- **Non-vacuity:** the skip-path test must fail if the stamp is written unconditionally. That is the
  whole correctness claim.

## Estimated risk

**LOW.** Additive field on a file we already write atomically, no new shared-path ownership, no
deletion. The risk is entirely in the semantics: a stamp that is absent-but-fine, or present-but-
false, is worse than nothing — which is why the design question above is a prerequisite and not a
detail.

## Provenance

Found 2026-08-04 while answering `ai-maestro#99`, which had sat 7 days with zero CORE comments. The
`lib/janitor-control.ts` NEVER-WRITE rule was found by reading the module header *after* deciding to
add a writer to it — recorded here because the near-miss is the useful part.

## Approval log
