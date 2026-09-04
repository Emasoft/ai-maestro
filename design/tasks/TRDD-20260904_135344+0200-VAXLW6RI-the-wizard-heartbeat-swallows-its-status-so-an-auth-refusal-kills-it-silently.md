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

**That report was ACTED ON.** `components/HaephestosEmbeddedView.tsx:107-119` records the fix —
*"WT-004#1 (SCEN-004 P0-002, 2026-04-16): hardened heartbeat protocol. Three improvements over the
previous setInterval/30s/catch(()=>{})"*: interval halved to 15s, exponential backoff added, and
the interval suspended while the tab is hidden. The watchdog also moved to 30 min.

So the April report is **not** a second sighting of this bug; it is the sighting that produced the
current, better code. What survives the hardening is the narrow residue below — and stating it as
two sightings would have made a fixed defect look like a recurring one, which is the kind of claim
that gets a card prioritised on false grounds.

## What actually remains — the residue the 2026-04-16 hardening did not cover

The backoff is undifferentiated. It caps at `attempt = 4`, so a **permanent** failure (401/403)
retries at 8s forever and never surfaces. The catch cannot distinguish it from a transient 503,
which is precisely what the backoff was added FOR. With the watchdog now at 30 min the reap is
slow rather than 2-minute-fast, but the end state is the same and the user still sees no error.

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
