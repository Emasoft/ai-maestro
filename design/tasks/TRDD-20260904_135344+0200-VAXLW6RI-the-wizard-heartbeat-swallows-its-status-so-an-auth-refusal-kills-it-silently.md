---
trdd-id: VAXLW6RI
title: The wizard heartbeat cannot tell a permanent refusal from a transient blip so it retries forever
column: todo
created: 2026-09-04T13:53:44+0200
updated: 2026-09-04T13:53:44+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
priority: 2
severity: medium
effort: low
min-approval-requirement: none
labels: [ui, haephestos, error-handling, found-by-review-fork]
---

# The wizard heartbeat cannot tell a permanent refusal from a transient blip so it retries forever

## Problem

`components/HaephestosEmbeddedView.tsx:129-140` polls `POST /api/agents/creation-helper/heartbeat`
every 15s. On a non-ok response it throws into a `catch` that does exactly one thing — schedule an
exponential-backoff retry:

```ts
const res = await fetch('/api/agents/creation-helper/heartbeat', { method: 'POST' })
if (!res.ok) throw new Error(`heartbeat ${res.status}`)
attempt = 0
} catch {
  attempt = Math.min(attempt + 1, 4)
  retryTimer = setTimeout(sendHeartbeat, 1000 * Math.pow(2, attempt - 1))
}
```

The status is **never surfaced**. A PERMANENT failure (401/403) is retried forever with the same
result, the watchdog is never fed, and the Haephestos session is reaped mid-creation. To the user
the wizard just **dies with no error** — indistinguishable from a crash.

The `catch` cannot tell a transient 503 from a permanent 403, and treats both as "retry".

## One prior sighting, against a DIFFERENT implementation — corrected

An earlier draft of this card claimed "two independent sightings" of this defect, citing
`tests/scenarios/reports/scenario_proposed-improvements_004_20260413T230044Z.md`. **That
overstates it, and an adversarial review caught it.** Read in full rather than as a grep line,
that report describes race #4 against the code as it was in April: `setInterval` at **30s** with
`fetch(...).catch(() => {})`, a 120s watchdog, and "exactly 4 missed heartbeats are fatal".

**That report was ACTED ON** — and here is which parts of that I VERIFIED versus took from prose,
because an earlier draft of this card stated all of it flatly and one item was WRONG.

`components/HaephestosEmbeddedView.tsx:107-119` *claims* the fix: *"WT-004#1 (SCEN-004 P0-002,
2026-04-16): hardened heartbeat protocol. Three improvements over the previous
setInterval/30s/catch(()=>{})"*. A comment claiming a fix is not the fix, so each leg was read:

| claimed | verified? |
|---|---|
| interval halved 30s → 15s | **YES** — `setInterval(sendHeartbeat, 15_000)` at :144 |
| exponential backoff added | **YES** — `Math.pow(2, attempt - 1)` at :136-138 |
| suspend the interval on a hidden tab | **YES** — `visibilityState === 'hidden'` at :152, listener at :166 |
| *"The server watchdog fires at 30min"* (:111) | **NO — THAT COMMENT IS WRONG** |

**`services/creation-helper-service.ts:135` reads `const WATCHDOG_TIMEOUT_MS = 120 * 60 * 1000 //
120 minutes`.** The component's comment says 30 minutes; the server's constant is 120. An earlier
draft of this card repeated the 30 as fact, having taken it from that comment without opening the
file that owns the number — the third time in one session that prose was trusted for a runtime
value, and the first time it was actually false. **The stale comment is a small finding in its own
right**: it is the number a reader sizes the heartbeat budget against, and it is off by 4×.

So the April report is **not** a second sighting of this bug; it is the sighting that produced the
current, better code. What survives the hardening is the narrow residue below — and stating it as
two sightings would have made a fixed defect look like a recurring one, which is the kind of claim
that gets a card prioritised on false grounds.

## What actually remains — the residue the 2026-04-16 hardening did not cover

The backoff is undifferentiated. It caps at `attempt = 4`, so a **permanent** failure (401/403)
retries at 8s forever and never surfaces. The catch cannot distinguish it from a transient 503,
which is precisely what the backoff was added FOR. With the watchdog at 120 minutes (measured, not the 30 the
component's comment claims) the reap is slow rather than 2-minute-fast, but the end state is the
same and the user still sees no error.

**And note the title was wrong too**: the catch does not kill anything — it retries indefinitely.
The WATCHDOG reap is what ends the session. Corrected above.

## The new trigger, and why the gate is NOT the thing to revert

`enforceSystemOwner` is conditional on the user-authority model
(`lib/agent-auth.ts::buildAuthContext`, read directly — not taken from a docstring):

| model | `isSystemOwner` | wizard |
|---|---|---|
| **OFF (default, what ships)** | `!agentId` — any browser session | works |
| **ON** | ACTIVE MAESTRO only (`userTitle ∈ {maestro, maestro-delegate}`) | a normal user is refused |

Under model ON a normal user's wizard now 403s on every heartbeat and dies silently. That refusal
is the INTENDED semantics of `enforceSystemOwner` — the same source says the existing 24 such
routes "correctly reject" a normal user, and creating agents is plausibly a maestro capability.
**The defect is not the refusal; it is that the refusal is invisible.** An auth decision must not
be reverted to paper over a UI that hides its own errors.

## Derived fix — the stale comment that caused this card's own error

`components/HaephestosEmbeddedView.tsx:111` says *"The server watchdog fires at 30min, so 15s = 120
heartbeats per watchdog window."* The constant is **120 minutes**
(`services/creation-helper-service.ts:135`), so the real figure is 480 heartbeats per window. Fix
the comment in the same change — it is the number a reader sizes this budget against, and it
already misled one card (this one) into asserting 30 as fact.

## Aside — the suite flake that turned up while working this card, and how it was settled

A full-suite run failed with `tests/unit/oauth-alert-delivery.test.ts` as a FAILED SUITE while all
6646 tests passed (unhandled `ReferenceError: window is not defined` from react-dom). The first
reflex — *"I didn't touch that file"* — is a NON-SEQUITUR for a cross-file leak: the victim's
contents are irrelevant, what matters is which files share a worker, and adding a test file changes
exactly that. A review caught the fallacy.

**The first counterfactual was VACUOUS and said so only when checked.** `git stash push <path>` on
a file that is COMMITTED and clean stashes nothing, so six "without the file" runs all ran WITH it.
Worse, the paired `git stash pop` then applied an unrelated 2026-08-27 stash to the working tree
(142 lines across `CLAUDE.md` and another TRDD, plus a new `DELEGATION.md`). Re-stashed under an
explicit name; nothing lost. **A stash/pop pair around a committed file is a no-op followed by a
live grenade.**

Re-run with `vitest --exclude`, instrument-checked (508 → **507** files, so the exclusion demonstrably
landed):

| tree | runs | suite failures |
|---|---|---|
| WITH the new file | 10 | 1 |
| WITHOUT it (`--exclude`) | 6 | **1** |

A suite failure occurs on BOTH sides, so the non-determinism is **pre-existing** and the new file is
not implicated. Note the honest residue: the specific `window is not defined` string appeared in
exactly 1 of 16 runs, so its base rate is ~6% with an interval far too wide to characterise — "3 of
4 green" was never the reassurance it read as.

## Proposed fix

Distinguish permanent from transient in the `catch`: on 401/403 stop retrying and surface a
message naming the cause; keep the backoff for 5xx/network. Optionally cap total retry time so a
permanently-failing heartbeat reports rather than looping to the watchdog deadline.

## Verification

- A 403 from the heartbeat produces a VISIBLE error in the wizard, and does not silently loop.
- A 503 still retries with backoff and recovers (positive control — the fix must not turn a
  transient blip into a hard failure).
- Neuter: restore the undifferentiated `catch` and the first assertion must redden.

## Estimated risk

LOW. One `catch` block in one component; no server change.

## Approval log

- 2026-09-04T13:53:44+0200 — Tier 0 self-mandate: a UI error-handling fix inside this session's own scope, no
  governance surface. Filed while acting on an adversarial review of TRDD-DQVPODKW.
