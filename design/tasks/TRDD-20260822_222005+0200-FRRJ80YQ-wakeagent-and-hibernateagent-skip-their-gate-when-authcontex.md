---
trdd-id: FRRJ80YQ
title: wakeAgent and hibernateAgent skip their gate when authContext is absent — the bypass element-management already abolished
column: todo
created: 2026-08-22T22:20:05+0200
updated: 2026-08-22T22:20:05+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:20:05+0200
---

# wakeAgent and hibernateAgent skip their gate when authContext is absent — the bypass element-management already abolished

## Problem

`wakeAgent` and `hibernateAgent` in `services/agents-core-service.ts` take `authContext` as an
**optional** field of their params object, and their authorization gate is CONDITIONAL on its
presence. `hibernateAgent`'s own comment states the affordance outright:

> // When authContext is provided (route call), check caller permissions.
> // When absent (internal call), skip — backward compatible.
>     if (authContext) { if (!authContext.isSystemOwner) { … authorize('hibernate-agent', …) } }

`wakeAgent` is the same shape in one line: `if (authContext && !authContext.isSystemOwner) { … }`.
`WakeAgentParams.authContext` and `HibernateAgentParams.authContext` are both declared `?:`.

**This is the exact shape that `element-management-service.ts` abolished**, and that file records
why in `gate0Auth`'s own comment:

> Security invariant (Apr 2026): authContext is MANDATORY for every call. There is no "internal
> call" bypass anymore — internal callers (server startup, scheduled tasks, tests) MUST construct
> a SystemAuthContext via `buildSystemAuthContext()`. **Previously, a missing authContext was
> silently treated as "authorized" which allowed any route that forgot to pass it to bypass all
> security checks.**

So the repo holds three patterns for one question, and two of the three are right:

| module | on a missing `authContext` |
|---|---|
| `element-management-service.gate0Auth` | MANDATORY — the param is non-optional |
| `agents-messaging-service.sendMessage` | MANDATORY — `if (!authContext) return 401` at `:315`, before the sender-mismatch check at `:318` |
| **`agents-core-service.wakeAgent` / `hibernateAgent`** | **SKIP THE GATE** — and a comment advertising that as supported |

## This is NOT a live hole — and that is a measurement, not an assumption

Every production caller of both functions passes a context. Enumerated 2026-08-22 across
`app lib services components scripts server.mjs`:

- the three routes (`wake`, `hibernate`, `continuity/ensure-resume`) pass `auth.context`
- `services/headless-router.ts:1307,1313` pass `buildAuthContext(auth)`
- six `element-management-service` call sites pass `options.authContext` / a named gate context
- the two genuinely-internal callers pass `authContext: { isSystemOwner: true }` —
  `lib/fleet-hard-recovery-runner.ts:52` and `services/boot-restore-service.ts:181`

Those last two are the interesting ones: they are exactly the "internal call" the comment says may
omit the context, **and they do not omit it.** They already do the right thing. So the bypass the
comment describes is a path NOTHING TAKES, and no external caller can choose to take it — a route
cannot decline to pass what it already passes.

## Why file it anyway

The risk is the NEXT caller. The type permits omission, the gate rewards it with a skip, and the
comment tells a reader it is the supported way to make an internal call. That is three
independent invitations to reintroduce a bypass that a sibling module already paid to remove —
and the failure mode is silent, because omitting the context produces a SUCCESS.

## Proposed fix

Make `authContext` REQUIRED on `WakeAgentParams` and `HibernateAgentParams`, drop the presence
condition so the gate is unconditional, and delete the "backward compatible" comment rather than
leaving prose that documents an affordance the code no longer has. Internal callers already pass
`{ isSystemOwner: true }`, which the gate short-circuits on exactly as `gate0Auth` does — so this
should be a pure tightening with ZERO call-site changes, the same shape as TRDD-JWE3CFLV.

**Verify that claim before relying on it**: re-enumerate the callers at implementation time rather
than trusting this list, and let `tsc` prove the zero-call-site-change property.

## Verification

- A test calling `wakeAgent`/`hibernateAgent` with NO `authContext` is REFUSED rather than
  silently authorized. That test cannot be written today — the omission is legal and returns
  success — which is itself the finding.
- A MEMBER-title context is refused; a MANAGER context is allowed (positive control).
- NEUTER: restore the presence condition and the no-context test must redden.
- `tsc --noEmit` clean with no call-site edits.

## How this was found

Working TRDD-CAVCTULL's box *"the 12 forward-only routes verified against their pipelines' Gate
0"*. A sub-agent correctly reported all four `agents-core-service` routes as COVERED — which is
true, and was the question asked. Checking REACHABILITY rather than PRESENCE (a gate inside a
conditional is not a gate, per TRDD-JWE3CFLV) surfaced this one layer down. **The brief's scope,
not the worker's error:** I asked "does this route reach an authorize call", not "is that call
unconditional".

## Estimated risk

LOW severity today (no reachable bypass), LOW to fix. Priority is prophylactic: it removes a shape
that has already caused one measured incident in this repo.

## Approval log

- 2026-08-22T22:20:05+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
