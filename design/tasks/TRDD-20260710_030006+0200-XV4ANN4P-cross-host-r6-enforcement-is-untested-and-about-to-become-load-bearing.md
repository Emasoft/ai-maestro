---
trdd-id: XV4ANN4P
title: The receiving-host R6 check is untested and the forward-gate wiring makes it the only gate
column: complete
created: 2026-07-10T03:00:06+0200
updated: 2026-07-10T03:19:24+0200
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: S
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
task-type: security
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [amp, communication-graph, cross-host, test-coverage]
test-requirements: [unit]
audit-requirements: []
review-requirements: []
runtime-targets: [macos, linux]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-10T03:19:24+0200
implementation-commits: [ad7970a4]
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**DONE.** `tests/unit/amp-receiving-host-r6.test.ts` covers the receiving-host
graph check. The gate holds: a mesh-forwarded MEMBER→MEMBER is refused, COS→MEMBER
is delivered, and an absent **or forged** role attestation yields no sender title
at all, which the graph fails closed on (`communication-graph.ts:411`).

**Writing the test found that the first version of it was worthless, and this is
the part worth remembering.** `routeMessage` has **seven** other `403` exits before
the graph. The initial assertions checked only `status === 403`, and three of four
"passed" — on `:1008`, *"unsigned messages from mesh-forwarded senders are
rejected"*. The requests never reached the check under test. A test that asserts a
status code cannot tell a refusal from a different refusal. The suite now asserts
the graph's own error code (`title_communication_forbidden`) **and** that `deliver`
was never called, and the body carries the mandatory `signature` so the request
actually arrives at `:1286`.

Recorded because it generalises: **when a function has many exits with the same
status, the status is not evidence.** Assert the reason, and assert the side effect
that the reason was supposed to prevent.

Second thing learned, not a defect: for a mesh-forwarded sender `senderKeyPair` is
`null` by construction (`amp-service.ts:937`), so the agent signature is discarded
unverified (MF-03) — mesh trust rests on the forwarding **host's** signed role
attestation, not on the agent's own signature. That is why the attestation cases
above are the ones that matter.

**This is an EHT authored BEFORE the change that opened the hole**, which is the
order the platelet rule asks for. It is a sibling of `TRDD-YEE33F3A` in the flock of
`TRDD-SCLSRS6E`, not its child (depth-1). Prose lineage: it is an effect of
YEE33F3A's Phase-2 wiring of `lib/message-route-gate.ts`.

### The hole the wiring opens

Today an agent sending to `bob@otherhost` through the agent-scoped route is
**denied at the sender**, by accident:

- `services/send-message-service.ts:281` initialises `recipientTitle = 'unknown'`.
- G05 (`:287`) strips `@hostId` and looks the bare name up in the **local** registry.
  A remote agent is not there, so the title stays `'unknown'` — a *truthy string*,
  so it never reaches `validateMessageRoute`'s safe `!recipientRole` default.
- G06 (`:379`) therefore calls `validateMessageRoute(sender, 'unknown')`, which
  fails `isValidRole` and returns `Unknown recipient role: unknown`. Denied.

Wiring the gate fixes that: an explicit `name@hostId` whose host is not `isSelf`
gets the sender-side weak check (`getAllowedRecipients(senderTitle).length > 0`) and
is allowed to leave, exactly as `services/amp-service.ts:1111-1124` already does.
The **full** graph check then happens on the receiving host, in the local-delivery
branch a peer's `/api/v1/route` re-enters — `services/amp-service.ts:1286`.

That is correct: a governance title lives on its owner's host, and a sender-side
copy read from `agent-directory` is a stale mirror. But it moves
`amp-service.ts:1286` from *belt on top of braces* to **the only gate** on the
cross-host path. And **no test exercises it.** Grepped `tests/` for
`validateMessageRoute` / `amp-service`: the four hits are graph-unit tests
(`communication-graph-*.test.ts`, `message-route-gate.test.ts`) plus a scenario
markdown. None reaches `amp-service`'s delivery path.

### NEXT ACTION

Add a unit test over the local-delivery branch of `amp-service.ts` that asserts the
graph is enforced there — a forbidden sender→recipient title pair arriving as if
from a peer host is **rejected**, and the allowed pair is delivered.

**Falsify the denial as "no message was written to the recipient's `inbox/`"**,
never as a 403 status alone. A route that returns 403 after writing the message has
not denied anything.

### Load-bearing facts

- `evaluateExitGate`-style belt-and-braces reasoning does not apply here: after the
  wiring there is exactly ONE graph check on the cross-host path, and it is remote.
- The sender-side check that remains is deliberately weak (`can this title message
  *anyone*`). It is not a substitute; it only catches a title with no outbound edges
  at all (today: none — every title has at least one).
- An **unresolved local** name must keep being denied. Remote is `name@hostId` whose
  host is not `isSelf`, **never** merely "not found in the registry". The gate
  (`lib/message-route-gate.ts`, `isRemoteRecipient`) already encodes this; the test
  must pin it.

## Verified NON-effects, recorded so nobody re-derives them

The wiring's other two observable changes were checked and are **not** holes:

1. **Forward starts returning 403 for a graph-forbidden agent sender.** Both UI
   surfaces already render the reason: `components/MessageCenter.tsx:214` and
   `components/MobileMessageCenter.tsx:187` both toast `Failed to forward:
   ${error.error}` on a non-OK response. No UI work is needed, provided the denial
   keeps the `{ error: <reason> }` shape every other gate returns.
2. **An agent-initiated forward that violates R6 begins to fail.** No CLI caller
   exists — the installed `amp-*` wrappers have no `forward` verb (checked
   `~/.local/bin`), and the only callers of `forwardFromUI` are
   `services/messages-service.ts:442` (system-owner path) and
   `services/agents-messaging-service.ts:452` (the agent-scoped route this TRDD's
   sibling is fixing). Nothing downstream breaks.

Recorded rather than authored as platelets: a derived TRDD invented to satisfy a
quota dilutes the ones that matter and misstates the blast radius.

## Why `min-approval-requirement: none`

Local, reversible, adds a test; no baseline deviation, no governance change, no
cross-project or release surface. Authored directly as a self-mandate.
