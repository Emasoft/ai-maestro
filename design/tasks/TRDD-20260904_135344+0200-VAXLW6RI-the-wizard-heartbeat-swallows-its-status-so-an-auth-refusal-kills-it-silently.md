---
trdd-id: VAXLW6RI
title: The wizard heartbeat swallows its status so an auth refusal kills the session silently
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

# The wizard heartbeat swallows its status so an auth refusal kills the session silently

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

## Two independent sightings

1. **2026-04-13**, `tests/scenarios/reports/scenario_proposed-improvements_004_*.md`: a single 503
   during a hot reload is silently swallowed, and with a 120s watchdog against a 30s check
   interval "exactly 4 missed heartbeats are fatal".
2. **2026-09-04**, an adversarial review of TRDD-DQVPODKW. That card gated `heartbeat` with
   `enforceSystemOwner`, which gives the swallow a SECOND and deterministic trigger — see below.

Two sightings 5 months apart, neither carded until now.

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
