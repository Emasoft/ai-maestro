---
trdd-id: V2BLADSF
title: Group creation lets any authenticated agent inject arbitrary text into any other agent's live session as AI Maestro
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T13:48:51+0200
updated: 2026-08-26T14:01:02+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
labels: [security, prompt-injection, governance-bypass, route-authz]
external-refs: [TRDD-R268J32X]
---

## Problem

`services/groups-service.ts` states its own invariant, in a comment, at `subscribeAgent:239`:

> **"No agent can silently subscribe other agents to broadcasts."**

`createNewGroup` breaks it, and `updateGroupById` breaks it a second way. Neither is a policy
question — the file already decided the policy and two of its functions do not implement it.

### The chain, every hop read first-hand

1. **`createNewGroup:116`** — deliberately open: *"Any authenticated caller (system-owner OR a real
   agent) may create a group — there is no governance gate on creation, only on mutation/delete."*
   It validates `name` and that `subscriberIds` is an **array**, and nothing else about it.
2. **`lib/group-registry.ts:326`** — `subscriberIds: data.subscriberIds ?? []`. Verbatim. No
   consent check, no membership check, no filter. So the creator names **every agent on the host**.
3. **`notifyGroupSubscribers:347`** → `checkGroupMutationAuth`, which allows
   `group.subscriberIds?.includes(authContext.agentId)` (`:62`). The attacker put itself in the
   list in step 1, so it passes as a legitimate subscriber.
4. **`lib/notification-service.ts:169`** — `await sendTmuxNotification(sessionName, notification)`.
   The payload is **injected into the target agent's live tmux pane, and SUBMITTED**. The body
   (`:55-71`) was read after `export/jobs` proved that a signature is not a behaviour:

   ```ts
   const sanitized   = message.replace(/[\x00-\x1F\x7F]/g, '')
   const safeMessage = sanitized.replace(/'/g, "'\\''")
   await runtime.sendKeys(target, `echo '${safeMessage}'`, { literal: true, enter: true })
   ```

   **`enter: true`.** It is not a message left on screen for a human to notice — the line is typed
   and the return key is pressed. The function's own comment (NT-027) records the consequence:
   *"If the session is running a non-shell program (vim, REPL, TUI), this echo command will be
   typed as input to that program. Notifications are designed for idle shell prompts."* **Every
   target here is a Claude Code session**, so the attacker's text is not echoed by a shell — it is
   submitted to another agent's model as a turn.

   The single-quote escaping and control-char strip are real and hold: this is **not** shell
   injection. It does not need to be. The delivered payload is prose, and prose is the payload.

### Why this is worse than group spam

- **It is cross-agent prompt injection.** The text lands in another Claude Code session's input.
  Control characters ARE stripped (twice — in `notifyGroupSubscribers` and again in
  `sendTmuxNotification`), so the PAYLOAD cannot escape `send-keys` and cannot smuggle its own
  newline. That guard holds and must stay. **But the notifier presses Enter itself
  (`enter: true`), so the payload never needed to** — and prompt injection needs no control
  characters in the first place.
- **It impersonates the system.** `notifyGroupSubscribers` passes a hardcoded
  `fromName: 'AI Maestro'`, and `formatNotification:76` renders exactly `{from}` + `{subject}`. The
  real sender's `agentId` appears **nowhere** in what the target sees. The target cannot tell an
  operator broadcast from another agent's.
- **It bypasses the R6 communication graph.** `messages/forward` — decided CLEAR an hour ago under
  TRDD-R268J32X — runs `checkMessageAllowed` **and** `assertForwardRouteAllowed` before a single
  message reaches one recipient. This path reaches **every** agent and consults neither. An agent
  whose title may message nobody can still deliver text to everybody.
- **The rate limit caps calls, not reach.** 10 broadcasts/min per sender
  (`GROUP_NOTIFY_LIMIT_PER_MIN`), and one broadcast is one message per subscriber. It bounds
  frequency; it does not bound the audience the attacker chose in step 1.

### The second door

`updateGroupById:177` accepts `subscriberIds` wholesale and is gated by the same
`checkGroupMutationAuth`, i.e. **any current subscriber**. So an agent that legitimately
self-subscribed to any existing group can then add every other agent to it. Fixing creation alone
leaves this open.

## What is NOT the problem

- The routes. All five (`groups`, `groups/[id]`, `groups/[id]/notify`, `.../subscribe`,
  `.../unsubscribe`) call `enforceAuth` AND forward `buildAuthContext`. `subscribeAgent:257` and
  `unsubscribeAgent` correctly enforce self-only-unless-MANAGER. The route layer is fine.
- `checkGroupMutationAuth` itself. It is a real gate (401 on no context, 401 on no agentId,
  MANAGER or current-subscriber, else 403). It is being satisfied honestly by an attacker who made
  itself a subscriber.
- The control-character strip. It works and must stay.

## Proposed fix — the shape is a RULING

1. **Apply `subscribeAgent`'s rule to the subscriber LIST, wherever it is written.** A non-MANAGER,
   non-owner caller may name only itself in `createNewGroup.subscriberIds` and may only add itself
   via `updateGroupById`. One shared helper called from both, so the two doors cannot drift —
   `subscribeAgent` already contains the predicate to lift.
2. **Or gate `notifyGroupSubscribers` on the R6 graph** (`assertAgentRouteAllowed` per recipient,
   as `forwardFromUI` does), so an arbitrary subscriber list stops being a delivery channel. This
   is the stronger fix and the more invasive one; it also changes behaviour for groups the operator
   built legitimately.
3. **Independently of 1/2: stop attributing an agent-initiated broadcast to `'AI Maestro'`.** Pass
   the real sender. A system identity on attacker-controlled text is its own defect, and the
   cheapest half of this card.

Anything that only tightens the rate limit is NOT a fix — the limit was never the boundary.

## Caller enumeration — DONE 2026-08-26, and it SHARPENS fix 1 rather than complicating it

Three call sites create a group. Measured over `app components lib services scripts tests`,
counted before reading:

| caller | `subscriberIds` it sends | affected by fix 1? |
|---|---|---|
| `components/sidebar/GroupListView.tsx:77` | operator-chosen list | **NO** — operator UI, the caller is system-owner and fix 1 exempts the owner |
| `components/governance/GroupSubscriptionSection.tsx:120` | `[agentId]`, with the comment *"auto-subscribe the current agent"* | **NO** — already self-only, which IS the rule |
| `scripts/aimaestro-groups.sh:185` | `--subscribers` CSV, arbitrary | **YES**, and deliberately — this is the abuse vector |

**The agent-facing UI already does exactly what the fix would require.** So fix 1 does not impose a
new discipline on agents; it makes the CLI agree with the panel. The only behaviour that changes is
a non-MANAGER agent naming OTHER agents via `aimaestro-groups.sh create --subscribers a,b,c`, which
is precisely the capability this card says must not exist. **A "breaking change" that breaks only
the exploit is the fix, not a cost of it.**

That also settles a question the fix would otherwise have to guess: the operator genuinely needs
multi-subscriber creation (`GroupListView`), so the rule cannot be a blanket "creator only" — it
must be **self-only for a plain agent, unrestricted for MANAGER and the system owner**, which is
`subscribeAgent:257`'s existing predicate verbatim. One helper, lifted, not invented.

## Verification

- Agent A creates a group naming agent B as a subscriber → **refused** (neuter: remove the check,
  test reddens).
- Agent A, a subscriber of group G, PUTs `subscriberIds: [A, B]` → **refused**.
- POSITIVE CONTROL: agent A creates a group naming only itself → still succeeds; MANAGER and the
  system owner may still name anyone.
- Assert **no `sendTmuxNotification` call** on the refusal path — a 403 after delivery is still an
  injection.
- Re-run `tests/unit/agent-route-authorization-coverage.test.ts`: these five routes sit in the
  forward-only tier. The fix is service-side, so the ledger should NOT move — confirm it does not,
  rather than assuming.

## Acceptance

- [x] **Callers enumerated (2026-08-26) — fix 1 costs nothing at either UI caller; the only
      affected path is the CLI's arbitrary `--subscribers`, which is the vector itself.** Section
      above. It also fixes the rule's shape: self-only for a plain agent, unrestricted for
      MANAGER/owner (the operator UI genuinely needs multi-subscriber creation)
- [ ] Ruling recorded here (fix 1, fix 2, or both; fix 3 is independent and cheap)
- [ ] Guard implemented in ONE helper shared by `createNewGroup` and `updateGroupById`
- [ ] Refusal tests (create-with-foreign-subscriber, update-adds-foreign-subscriber) + neuter recorded
- [ ] Assertion that no notification was delivered on refusal
- [ ] Positive control (self-only create; MANAGER may name others) still green
- [ ] Sender attribution decided — `'AI Maestro'` vs the real agent

## Approval log

- 2026-08-26T13:48:51+0200 — FILED, `min-approval-requirement: manager`. Found while deciding the
  five `groups/*` routes for TRDD-R268J32X. The routes are clean; the hole is two functions below
  them, and the file's own comment at `subscribeAgent:239` is what identifies it as a defect rather
  than a policy gap — the invariant was already chosen and two writers do not honour it.
