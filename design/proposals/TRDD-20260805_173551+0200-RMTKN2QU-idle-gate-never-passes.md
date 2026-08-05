---
trdd-id: RMTKN2QU
title: The sendCommand idle gate can never pass — fix it or delete it
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: user
mandate: false
approved: false
severity: high
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [presence, injection, idle-gate, live-fleet-change]
external-refs: [Emasoft/ai-maestro#110, Emasoft/ai-maestro#51, Emasoft/ai-maestro#60]
---

# The sendCommand idle gate can never pass — fix it or delete it

## Problem

`sendCommand`'s `requireIdle` defaults to **true**, and the gate it guards is unsatisfiable:

```
services/sessions-service.ts:1340   sessionActivity.set(sessionName, Date.now())   // the bump
services/sessions-service.ts:1342   if (requireIdle && !isSessionIdle(sessionName)) -> 409
services/sessions-service.ts:307    const activity = sessionActivity.get(name)
                                    if (!activity) return true
                                    return (Date.now() - activity) > IDLE_THRESHOLD_MS
```

The bump writes `Date.now()` on the line *before* the check, so the elapsed time is ~0 and can never
exceed the threshold. The `!activity` early-out cannot rescue even the first call, because the bump
has already written the entry. **Every call 409s — including the first against a completely fresh
session.**

## Evidence

Pinned by a characterisation test in `5466292c` that seeds **no** activity, asserts the map is
genuinely empty for that session first, then calls `sendCommand` with the default and gets **409
with `sendKeys` never called**. Proven, not reasoned.

## Why it survived

The neighbouring `returns 409 when session is not idle and requireIdle is true` test seeds recent
activity explicitly, so it reads as though the seeding is what causes the refusal. It is not. And
the happy-path test carries a comment saying `requireIdle` must be false *"to test basic
command-sending behavior"* — the trap was noticed twice at the test layer and worked around both
times rather than named.

## Consequences (this is why it is not a small bug)

- The "protect a busy agent" gate protects nothing. It refuses everything.
- **The CLI's hardcoded `require_idle=false` is a WORKAROUND, not an oversight.** So #110's
  originally-planned fix — make the CLI omit the field so the server default applies — would 409
  **every** CLI injection, not merely those on a busy pane. My earlier statement that it would only
  affect a busy pane was incomplete in the direction that matters.
- #51's wake mechanism cannot use the default path at all.
- #60's daemon freeze-recovery must pass `requireIdle: false` or it is refused precisely when a
  frozen agent needs it — a frozen agent is by definition never idle.

## Proposed fix — the USER picks one

1. **Fix the gate.** Check idle *before* bumping activity, or bump only on the success path — which
   is where the ai-maestro#117 injection mark already sits, placed there deliberately for this exact
   reason. The server default then becomes meaningful and the #110 CLI change becomes correct.
2. **Delete the gate.** Stop implying a protection that has never existed.

Either is a live-fleet behaviour change, which is why this is a proposal and not a task.

## Verification

The characterisation test in `5466292c` **must be inverted** as part of the fix: under option 1 a
fresh session must return 200 with `sendKeys` called once. Leaving it asserting 409 would pin the
bug the fix removes.

## Estimated risk

MED — the code change is a few lines, but it changes the refusal behaviour of every injection path
in the fleet simultaneously. Dependencies: #110's CLI change must land in the same wave, or the CLI
keeps passing `require_idle=false` and nothing observable changes.

## Approval log
