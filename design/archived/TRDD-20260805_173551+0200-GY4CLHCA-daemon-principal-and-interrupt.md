---
trdd-id: GY4CLHCA
title: A non-agent daemon principal and an interrupt action for freeze-recovery
column: cancelled
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-21T22:00:37+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:00:37+0200
severity: medium
effort: medium
relevant-rules: [42]
npt: []
eht: [7J6RIOU1]
blocked-by: []
release-via: none
labels: [daemon, auth, freeze-recovery, cross-repo]
external-refs: [Emasoft/ai-maestro#60, Emasoft/ai-maestro#42]
---

# A non-agent daemon principal and an interrupt action for freeze-recovery

## Problem

The janitor daemon needs to deliver recovery commands — and a raw interrupt — to a **frozen** agent
through an authenticated server-side channel rather than by typing keystrokes into a pane.

Two things the request assumes are wrong, both verified:

**The interrupt primitive already exists.** `AgentRuntime.sendKeys(name, keys, opts?)` sends a **raw
tmux key name** when `literal` is falsy — `lib/agent-runtime.ts:351` says so — and
`prepareShellForLaunch` (`:486-506`) already presses `C-c` to abort a stuck child. What is missing is
**exposure**: `sendCommand` hardcodes `{ literal: true, enter: addNewline }` at
`services/sessions-service.ts:1351`, so nothing on the HTTP surface can reach the non-literal path.

**No new transport is needed.** `POST /api/sessions/[id]/command` is live in **both** server modes.
The blocker is a **principal**: `sendCommand` skips authorization entirely when
`authContext.isSystemOwner`, and otherwise calls `authorize(auth, 'send-command', targetAgentId)` —
and **R42 / TRDD-BF3JN4TL made `send-command` SELF-ONLY for agents**. The daemon has no pane, so it
cannot be modelled as an agent; the only currently-reachable path is the system-owner credential,
which is exactly the over-privilege least-privilege asks us to avoid.

## Proposed fix

1. A **non-agent daemon principal** — enrolled Ed25519 pubkey, its own class, granted exactly two
   verbs (`submit-recovery-prompt`, `interrupt`).
2. An **`interrupt` action** wired to the existing non-literal `sendKeys`.
3. **Replay protection** (`nonce` + `issued_at` skew) — the one piece `lib/amp-keys.ts` and
   `lib/amp-auth.ts` do not already provide. Everything else is there: `generateKeyPair`,
   `signMessage`, `verifySignature`, `calculateFingerprint`, a registration store, and a full bearer
   principal with rotation/revocation/expiry. **Do not parallel-build a second signing scheme** — a
   second thing to rotate, revoke and audit.
4. Reachable in **both** modes. A route added to one only is a recurring defect here (measured:
   `/api/sessions/me/user-input` exists in Next and in **none** of the headless router's 251
   entries).

## The operational trap this must document

The daemon **MUST pass `requireIdle: false`**. A frozen agent is by definition never idle, and
[[RMTKN2QU]] shows the gate refuses everything anyway — so without the flag every recovery attempt
is refused precisely when it is needed.

## Verification

The daemon principal can `interrupt` a busy pane and cannot do anything else — assert the refusal of
a third verb explicitly, since a grant that silently covers more than two verbs looks identical to a
correct one from the success path. A replayed `nonce` must be rejected.

## Estimated risk

MED — a new authentication principal with write access to agent panes. Bounded by the two-verb
grant, which is the part the verification must actually pin.

**Open question put to the janitor on #60 and not yet answered:** must the interrupt be
**synchronous** (report whether the turn actually broke, as `prepareShellForLaunch` does) or is
fire-and-forget enough? That decides one call versus a call plus a poll, and it is the only part of
the shape that cannot be settled from their issue.

## Approval log

- 2026-08-21T22:00:37+0200 — **CANCELLED as OBSOLETE (min-approval-requirement: manager)** by
  ai-maestro-hub-session. This card's whole premise — an external janitor daemon calling in
  through an authenticated server-side channel — was tried under a sibling TRDD
  (`TRDD-APN5WB2L`, commit `01747710`, same day) and **reverted within the hour by explicit USER
  ruling** (commit `c7aaa6ab`, "the server does not authenticate itself to itself": the janitor's
  continuity daemon is ABSORBED into this server, so there is no external daemon to authenticate;
  recovery actions are in-process function calls made by the server's own
  `startFleetLivenessWatchdog` / fleet-recovery runner). `TRDD-APN5WB2L` is itself
  `column: superseded` (`superseded-by: [5H5PBNEB]`). The interrupt CAPABILITY this card asked for
  does exist — `interruptSession` (`services/sessions-service.ts:1419`) exposes the non-literal
  `sendKeys` path — but as an in-process function callable only by the server's own recovery
  machinery, explicitly documented as "not exposed as a route, and must not become one"
  (`tests/services/interrupt-session.test.ts:4`), the opposite of this card's proposed shape
  (an enrolled Ed25519 daemon principal + an authenticated route). The need is met; the specific
  mechanism this card proposed is the one the USER ruled out. Cancelled as obsolete, not refused.
  Its EHT `[[7J6RIOU1]]` (the injection-mark hole this card would have opened) is independently
  cancelled as obsolete for the same reason: the mark landed with the shipped `interruptSession`.