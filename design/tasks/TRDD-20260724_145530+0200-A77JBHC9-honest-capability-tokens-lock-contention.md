---
trdd-id: A77JBHC9
title: Honest capability tokens and control-plane lock contention
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:52:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**COMPLETE 2026-07-24 (half-1 done + verified; half-2 relocated to D4, blocked on the janitor).**

**Load-bearing grounding (read the janitor daemon, not the summary):** the janitor daemon EXITS
ENTIRELY when the server-liveness file is FRESH (`daemon.py:2032`, `exit_reason="server-owns-host"`;
its own comment: "we get out of its way ENTIRELY — not the rev-4 per-chore yield"). So the daemon's
exit is FRESHNESS-only; the `capabilities` array is ADVISORY — for the OUTSIDE #N process and
observability, NOT the daemon's exit gate. This is WHY D1's tick+supervisor absorption is what
actually prevents token-death (the daemon is already gone once the server is up), and why capability
honesty is polish, not the load-bearing fix.

**Half-1 (capability honesty) — DONE, already proven by existing tests:**
`lib/server-liveness.ts::currentCapabilities` already advertises `family-a` iff `oauthTickEnabled()`
and NEVER pushes `singleton-chores`/`fleet-recovery` until their chores are built — the exact
janitor#100 honesty rule. Proven by `tests/unit/server-liveness.test.ts:40-48` (false→[], true→
['family-a'], the other two absent). DECISION: `family-a` stays gated on the TICK (the credential-
WRITE chore) — NOT loosened to the rotator opt-in. The supervisor beat (D1) is alert-only and runs
opt-in-gated WITHOUT advertising a token; that is UNDER-claiming, the safe direction ("an absent
token means the janitor still owns this"). Only OVER-claiming is the hazard, and this avoids it.

**Half-2 (flock contention) — RELOCATED to D4 (S5RUHJRP) + BLOCKED on the janitor:** the spec said
"extend `janitor-control.ts` to flock(2)-contend", but that module is READ-ONLY by construction
(HARD RULE 1: no writer, exports none) — adding a lock contender there breaks its documented
invariant. The shared-lock contention belongs with the CHORE that uses the lock (the marketplace/
user-plugins chore = D4), and it is blocked: the control dir today holds ONLY `oauth-rotator-tick.lock`
— the janitor has NOT yet moved `marketplace-op.lock` there. D4's STATE now carries the flock
requirement (add `flock(2)` on `marketplace-op.lock` when it builds the chore, once the lock exists).

**`$JANITOR_CONTROL_DIR` isolation — DONE, already proven:** `janitor-control.ts::janitorControlDir()`
resolves the override at call time; `tests/unit/janitor-control.test.ts` isolates it to a temp dir
and proves the reader NEVER creates the dir (the janitor's leaked-live-flag hazard). 22/22 pass.

## Spec

- `lib/server-liveness.ts::currentCapabilities` advertises `family-a`/`fleet-recovery`/
  `singleton-chores` **only when that chore is actually live** (a token without a live chore
  silences the janitor on work nobody does). — DONE (already correct + tested).
- ~~`lib/janitor-control.ts` extends to `flock(2)`-contend~~ — RELOCATED to D4: the flock belongs
  with the marketplace chore, and is blocked on the janitor moving `marketplace-op.lock` to the
  control dir (only `oauth-rotator-tick.lock` exists there today).
- Isolate `$JANITOR_CONTROL_DIR` in test setup BEFORE the first flag test — DONE (already isolated).

## Acceptance

- [x] A token appears iff its chore runs — `server-liveness.test.ts:40-48` (family-a iff oauthEnabled;
      singleton-chores/fleet-recovery absent until built). Grounding: the daemon exits on FRESHNESS,
      not tokens, so honesty here is for #N/observability.
- [x] A test proves the flag-path isolation — `janitor-control.test.ts` isolates `$JANITOR_CONTROL_DIR`
      to a temp dir and proves the reader creates nothing.
- [x] Never write a control flag automatically — `janitor-control.ts` has NO writer and exports none
      (read-only by construction, HARD RULE 1); the reader creates nothing (tested).

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T16:52:00+0200 — COMPLETED by ai-maestro (self-mandate). Half-1 (honesty) + `$JANITOR_CONTROL_DIR` isolation already correct & tested (22/22); grounded the daemon's freshness-only exit; relocated the flock half to D4 (blocked on the janitor). dev → complete.
