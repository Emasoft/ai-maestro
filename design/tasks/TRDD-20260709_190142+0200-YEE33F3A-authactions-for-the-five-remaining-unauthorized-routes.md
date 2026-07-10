---
trdd-id: YEE33F3A
title: Decide the AuthActions for the five remaining unauthorized agent-scoped routes
column: planned
min-approval-requirement: manager
created: 2026-07-09T19:01:42+0200
updated: 2026-07-10T03:19:24+0200
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: M
task-type: security
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: eht
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [authorization, agent-routes, authaction, security]
test-requirements: [unit]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api]
attempts: 5
implementation-commits: [f56b79f2, 28593ed7, 505ae8c9, 1ad04ade, c8903197, 2fd32899, 03159944, 26c958c3, b4003e4f]
external-refs: []
---

# TRDD-YEE33F3A — the five routes that need an AuthAction that does not exist

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**▶ 2026-07-10T03:19 — XV4ANN4P is `complete` (`ad7970a4`), so `blocked-by:` is
empty again.** This TRDD is a flock sibling, not a child. Two structural facts,
both from today's USER rules:

- Under depth-1, this TRDD (`derived: true`) may not carry an `eht:` of its own, so
  the platelet for follow-up 1's Phase-2 wiring — **XV4ANN4P**, the untested
  receiving-host R6 check that the wiring makes load-bearing — is registered on the
  **parent** `TRDD-SCLSRS6E`. The gate that would have been `eht:` is carried here
  by `blocked-by:` instead: this TRDD cannot reach `complete` until XV4ANN4P closes.
- `parent-trdd:` moved from `TRDD-4Q7WMPZK` (itself derived) to `TRDD-SCLSRS6E`, the
  nearest non-derived ancestor. Prose lineage, since the graph no longer holds it:
  this TRDD is an effect of 4Q7WMPZK's audit.

XV4ANN4P also records the two **verified non-effects** of the wiring (both message
centers already render the 403 reason; no CLI forwards), so nobody re-derives them.

**Follow-up 1 is DONE (`26c958c3` gate, `b4003e4f` wiring).** Both senders now call
`assertAgentRouteAllowed`; forward answers **403** with `MessageRouteDenied` instead
of a 500; a missing `authContext` is refused, never read as the owner. Two things
the wiring had to get right, both found by reading rather than assuming:

1. **Cross-host was denied by accident.** G05 stripped the `@hostId`, so a peer
   agent kept the `'unknown'` title — a truthy string that skips
   `validateMessageRoute`'s safe default and lands on the invalid-role refusal.
   G05 now keeps the hostId and remote recipients take the weak sender-side check,
   with the receiving host running the real graph. That check is now the **only**
   one on that path, and it is untested — **TRDD-XV4ANN4P**, which blocks this TRDD.
2. **"Remote" is not "not self".** `to` is split naively on `@`, so
   `alice@default.local` or a typo arrives as a hostId that merely isn't us.
   `isRemoteRecipient` now also requires the host to exist in `hosts.json`, or an
   unknown suffix would skip the graph on the promise that another host will check
   it. Nothing is there. Pinned by `tests/unit/message-route-gate.test.ts`.

**Still open, and deliberately not decided here:** whether R6 should bind a
**system-owner** forward (a human forwarding from an agent's mailbox emits a
message whose declared sender is that agent). Today's no-graph behaviour is
preserved and the question is a Tier-2 MANAGER call, escalated rather than settled
inside a bug fix. `tests/unit/message-forward-r6-gate.test.ts` pins the current
behaviour so the decision, when it lands, changes a test on purpose.

**All 5 routes are FIXED. Five for five were mis-triaged in the body below,
because every one was triaged from the route's NAME rather than its service.**
Severity stays **CRITICAL**. Read the service first — this is a measured pattern,
not a caution. Two of the five escalated it beyond "imprecise": `element-inventory`
and `metrics` were both proposed for `modify-agent`, which is absent from
`SELF_DRIVE_ACTIONS` and would have DENIED each endpoint's only intended caller —
shipping a permanently broken feature under the banner of a security fix.

**Exactly ONE new AuthAction was warranted in the whole TRDD: `export-agent`.**
Three of the five ended with FEWER concepts than proposed (`view-transcript`,
`manage-messages`, `drive-subconscious` all rejected); one endpoint was deleted
rather than authorized. What remains is not a mapping problem but two open
questions: `amp-init` self-remint, and the dead `manage-amp-address` action.

### `messages/[messageId]` — DONE (`28593ed7`). Sender forgery, not "delete".

The Part-1 table says the risk is "an agent can delete the directives its COS
sent it". Reading the code found three defects, and DELETE is the least of them.

- **POST is not "mark read"** (that is PATCH). It is `forwardMessage`, and its
  path `id` becomes `forwardFromUI`'s `fromAgent` — which lands verbatim in the
  new message's `from`/`fromAlias`/`forwardedBy`, is written to THAT agent's
  `sent/` folder, is the identity the governance filter is evaluated against, and
  for a cross-host recipient is signed with the **HOST key** so the remote
  accepts it. **Any authenticated caller could send mail AS any agent.**
- **The same POST, aimed at the caller (`{to: <self>}`), reads any agent's mail.**
- `sendMessage` in the same file already carries the identical fix, commented
  SVC2-MAJ-06. Forward was missed.

**The same hole one path over:** `POST /api/messages/forward` took its sender
from `body.fromSession` and authenticated-then-discarded. Not agent-scoped, so
the coverage guardrail could not see it. And `headless-router.ts` had all five
handlers with **no auth at all** — TRDD-f4a8fa1c applied exactly this fix to the
global `/api/messages` family sitting beside them and skipped these.

**Decision — NO new AuthAction.** The proposed `manage-messages` is REJECTED. A
mailbox has an OWNER, and this codebase already authorizes mailboxes by
ownership (`listMessages` here; `denyForeignMailbox` in messages-service).
Adding `manage-messages` would create two mechanisms for one capability — the
split-brain the parent audit rejected for `manage-amp-address`. No governance
title, MANAGER and the owner's own COS included, may read another agent's mail.

**Self-delete PERMITTED, contra the body's suggestion.** The session-scoped twin
`removeMessage` already permits it (with a test), so forbidding it here only
moves an attacker one path over. And a mailbox delete is not the queue cancel:
cancel PREVENTS execution (a live control plane); deleting a delivered message
does not un-deliver it — the hook already surfaced it, the sender keeps a `sent/`
copy this route cannot touch, and R15.5 puts the durable record in the
git-tracked TRDD, not the inbox.

**Incidental bug fixed:** `/api/messages/forward` required `body.to` and
`body.message` — two fields the service never reads. Both Message Centers post
`{messageId, fromSession, toSession, forwardNote}`, so the **legitimate UI 400'd
while an attacker passed by adding two ignored keys.** The guard checked the
wrong contract.

### `subconscious` — DONE (`505ae8c9`). No action; the endpoint was deleted.

Third route, **third time the name produced a wrong severity.**
`triggerSubconsciousAction` does not drive anything: it returns `Unknown action`
(400) for **every possible input**, and has since TRDD-70a521d9 Phase 1 removed
the `consolidate` action with the RAG subsystem. Zero callers. Its own comment
admits it exists "only so clients that shipped with the old action names get a
structured 400 instead of a 404".

**Decision: no AuthAction. The POST is DELETED** (Next.js handler, headless twin,
and the service function). The project keeps one version of the code, and a
deleted primitive beats an authorized one. A stale client gets 405 rather than
400 — both errors, one no longer an unauthorized route.

**The real primitive was on the GET, which had no auth call at all.**
`getSubconsciousStatus` reaches `agentRegistry.getAgent()`, which **never returns
null**: it CONSTRUCTS an in-memory Agent for any id, runs `initialize()`
(cerebellum + subconscious + voice, then `start()`), and calls `evictIfNeeded()`
first. **Sweeping arbitrary UUIDs evicts live agents, one per request.** GET is
now `requireAuth` + ownership at both layers (self, or system-owner). No new
action — per-object state, so the mailbox rule applies; MANAGER is not exempt.
Sole caller is the dashboard indicator (system-owner), so nothing breaks.

Two corollaries, both previously believed otherwise:
- the service's `if (!agent) return 404` is **dead code**;
- **reading the status STARTS the thing it measures** — an observer effect on a
  GET, written in the function's own doc comment as though it were a feature.

Two false comments removed: `headless-router` claimed "the Next.js per-agent
subconscious GET calls enforceAuth" (it made no auth call at all), and the
headless POST passed the whole parsed **body** where the service expected an
`action` **string** — type-checking only because `readJsonBody` returns `any`, so
every call produced `Unknown action: [object Object]`.

### `element-inventory` — DONE (`1ad04ade`). The proposed action was INVERTED.

Fourth route, fourth mis-triage — and this one would have **broken the feature**,
not merely mislabelled it. The body proposes `modify-agent`. But `modify-agent`
is not in `SELF_DRIVE_ACTIONS`, so the universal self-target ban denies an agent
acting on itself — and the ONLY caller this endpoint exists for is an agent's own
SessionStart hook posting **its own** inventory. `modify-agent` would have
shipped a permanently uncallable endpoint.

The defect: `enforceAuth` again (authenticate, discard), so any agent token could
append forged snapshots to any agent's append-only ledger — the file the Session
Browser presents as "what Claude actually saw". Rule is **ownership**, exact match
on the bare id (the reader keys on the `deriveAgentIdFromCwd` UUID, so
`uuid@host` from an agent caller would create an orphan ledger). MANAGER not
exempt: an audit ledger is owned, not governed.

**Authorized, NOT deleted — and the contrast with `subconscious` is the rule.**
`triggerSubconsciousAction` could never succeed for any input, so it was deleted.
This writer *works* and its reader half is live; it merely has no caller yet
(Phase C2 never landed — nothing in this repo, `scripts/`, the headless router,
or the installed plugin v2.8.0 posts here, though the route's doc comment claimed
it did; corrected). **An unfinished feature gets a guard; a dead one gets
deleted.**

Shape note: the service returns `void`, so its guard throws a typed
`ForeignLedgerError` that the route maps to 403 — a denial falling into the
generic `catch` would surface as 500, indistinguishable from a full disk, and the
defence-in-depth layer would be invisible.

**Known, not fixed:** this POST's cognitive complexity is 34. Extract its
validation gauntlet in a separate commit; a refactor folded into a security fix
makes both harder to review.

### CARRIED FORWARD — `getAgent()` constructs and evicts on READ (NEW, MEDIUM)

Bounded, not fixed. `agentRegistry.getAgent()` is a *constructor* wearing a
getter's name; `getExistingAgent()` is the non-constructing sibling. Any read
path calling the former can evict a live agent. Ownership now bounds the
subconscious GET to self + system-owner, but the lifecycle bug is a distinct
mechanism (resource management, not authorization) and other callers may share
it. Fix separately, with evidence: switching `getSubconsciousStatus` to
`getExistingAgent` would also make its hardcoded `exists: true, initialized:
true` tell the truth.

### CARRIED FORWARD — forward bypasses the R6 title graph (NEW, MEDIUM)

`validateMessageRoute` is enforced only in `send-message-service` and
`amp-service`. `forwardFromUI` calls `checkMessageAllowed` (the team filter) and
never consults the title matrix. So **forward is a send primitive that skips R6
even for a legitimate sender** — a MEMBER may forward to another MEMBER, a blank
edge. With the forgery closed this is no longer impersonation; it is a distinct
defect with a distinct mechanism (a missing call, not a missing guard). Fix it
as its own unit: mirror `send-message-service.ts:366-379`, and keep the web UI
working (HUMAN has full `Y` to every node).

### The lesson, and it cost a false claim in a doc comment

The first version of the new suite was **vacuous**. Disabling the ROUTE guard
left all 16 tests green — the service guard silently covered for it, because two
layers returning an identical 403 are indistinguishable from the HTTP surface. I
had already *written* "removing it from only ONE layer still fails" as a comment
before testing it. Falsification caught my own comment lying.

The fix is `layer isolation`: fault-inject an inconsistent AuthContext that
disarms exactly one guard (unreachable in production, where
`isSystemOwner === !agentId`). Now route-guard-off fails exactly 1 test;
service-guard-off fails exactly 4. **Defence-in-depth needs per-layer tests, or
the layers cover for each other while being deleted one at a time.**

### `export` — DONE (`f56b79f2`). Key exfiltration, not confidentiality.

The Part-1 table triages `export` as `POST` / "any agent's FULL conversation
transcripts" / "confidentiality". Both halves are wrong:

- The sharp verb is **GET**, not POST. POST (`createTranscriptExportJob`) has
  **zero callers**; both dashboard dialogs use GET.
- GET streams `exportAgentZip()`, which does
  `archive.directory(getKeysDir(agent.id), 'keys')` — the directory whose
  `private.pem` `lib/amp-keys.ts` annotates **"Agent's private key (NEVER
  shared)"**. Plus `registrations/` (external provider API keys), `agent.db`, and
  every message.

So any agent token could take any other agent's **Ed25519 signing key** and forge
correctly-signed AMP messages as it, forever. The comm-graph gates who may SEND;
nothing gates who may SIGN, because a genuine signature is indistinguishable from
a genuine one.

**Decision** (made under the USER's standing "prioritize security"): new action
`export-agent`, special rule mirroring `register-agent` — **system-owner only,
every agent title denied**, MANAGER and the target's own COS included. MANAGER
governs an agent completely without its key; a COS coordinates a team, it does not
impersonate its members. Self-export denied too: it grants nothing (an agent reads
its own keys off disk today) and would make the API a one-request exfiltration
channel for a compromised agent. Both verbs carry the action; POST having no
callers means the strict side costs nothing. `view-transcript` was deliberately
NOT introduced — add it on purpose if a real self-export flow appears.

`services/headless-router.ts` had the same hole and **no auth call at all**; both
its handlers now call the same `authorize()`, so the two surfaces cannot drift.

### Why the audit missed it — the load-bearing lesson

Both guardrails filter on `export function (POST|PUT|PATCH|DELETE)`. The audit
equated **dangerous** with **mutating**. Exfiltration is a GET. `export` was even
*listed* in the coverage ledger — as an unreviewed POST — which understated it by
a wide margin.

`dangerous-primitive-authorization.test.ts` now carries two classes:
`DANGEROUS_FUNCTIONS` (write/drive, mutating verbs) and `EXFIL_FUNCTIONS` (reads
that emit secrets, **every** verb). The exfil class has **no debt ledger** — a
route handing out a private key has no acceptable interim state.

### `metrics` — DONE (`c8903197`). It validated none of its three inputs.

The Part-1 table calls this "low blast radius; data integrity only". Reading the
service found three independent defects — not who, not which field, not what
value — and the third refutes the severity.

- **WHO.** `enforceAuth` again: any agent token rewrote any agent's metrics.
- **WHICH FIELD.** The `increment` branch returned *before* the whitelist beneath
  it was ever consulted, so `metric` reached `incrementAgentMetric` as an
  arbitrary registry key — exactly the "arbitrary key injection" the whitelist's
  own comment claimed to prevent. And the whitelist was itself wrong: five of its
  six names (`totalConversations`, `totalTokens`, `lastActiveAt`,
  `sessionsCreated`, `commandsExecuted`) are not fields of
  `UpdateAgentMetricsRequest` at all, so a full update of a REAL field filtered to
  `{}` and returned **200 with the metrics unchanged**.
- **WHAT VALUE.** `amount` was unvalidated and `incrementAgentMetric` does
  `existing + amount`, so `amount: "abc"` stored the STRING `"0abc"` into e.g.
  `estimatedCost` — which `AgentProfile.tsx` renders with `.toFixed(2)`. One PATCH
  left the target agent's profile tab **permanently un-renderable**. A stored,
  cross-agent denial of view is not "data integrity only".

**Ownership, and `modify-agent` inverted for the second time.** Metrics are
counters an agent reports about itself; `modify-agent` is not self-drive, so it
would deny the only sane caller. MANAGER is not exempt — a metric is owned, not
governed. The whitelist is now pinned to the type with `satisfies`, so a rename is
a COMPILE error: a whitelist nobody can typo-check is how it came to name five
fields that never existed.

**Unfinished, not dead — and the distinction decided the outcome.** Zero callers
anywhere (no UI, no hook, no script, no plugin), and `incrementAgentMetric` /
`updateAgentMetrics` are reached *only* through this route. But the reader half is
LIVE: `AgentProfile.tsx` and `zoom/AgentProfileTab.tsx` render all eight metrics —
today, the zeros CreateAgent wrote. So it is authorized, unlike
`triggerSubconsciousAction`, which could never succeed for any input.

The GET is left **read-open on purpose**: `GET /api/agents/[id]` already returns
the whole record, metrics included, to the same caller, so an ownership gate would
be theater. But it made no auth call at all, and `middleware.ts` only regex-matches
the credential SHAPE ("the route handler does the full cryptographic verify"), so
it now calls `requireAuth` — the gap CC-GOV-008 closed on its sibling.

### NEXT ACTION — the five fixes are in; two questions and three follow-ups remain

`UNREVIEWED_INVENTORY` is down to **two**, and neither is a fix:

- `amp-init` — a hand-rolled `isManager` check that bypasses the matrix, letting an
  agent re-mint its OWN Ed25519 AMP identity keys. **Part 2: a decision.**
- `metadata` — a detector artifact; already authorized via `ChangeMetadata` G00.

**Part 3:** `manage-amp-address` is declared in the `AuthAction` union and asserted
in `tests/authorization.test.ts`'s SELF_FORBIDDEN list, but wired to zero routes.
Either the four address routes adopt it, or delete it. A decision, not a cleanup.

Then the three follow-ups this TRDD surfaced but did not fix:

1. **R6 graph bypass on forward** — CONFIRMED, and it is NOT a two-line mirror.
   `forwardFromUI` (`lib/message-send.ts:399`) runs `checkMessageAllowed` — the
   TEAM-GOVERNANCE filter — but never `validateMessageRoute`, the R6 TITLE graph.
   Different rules. `sendFromUI` skips the graph too, but the `SendMessage` AIO
   enforces it ABOVE that primitive (G05 resolves titles, G06 gates); forward has
   no AIO above it, so both `forwardMessage` services reach the primitive raw.

   Do NOT copy `send-message-service.ts:366-379` into `forwardFromUI`. G06 is a
   ~70-line gate carrying an R38.2 relational branch (`resolveUserSenderContext`,
   `resolveRecipientUserTitle`, the `userModelEnabled` flag), a fail-CLOSED catch
   (SVC2-MAJ-19), and `ops` logging. `validateMessageRoute`'s own contract is
   fail-closed for a `human` sender with no `userSender` block. A second copy of a
   governance rule WILL diverge.

   **Design (verified, not yet built):** extract G05+G06 into one shared gate —
   e.g. `lib/message-route-gate.ts::assertRouteAllowed({ senderAgentId, to,
   authContext, inReplyTo }) -> { allowed, reason, ops[] }` — and call it from BOTH
   the AIO and `forwardFromUI`. The plumbing exists: both `forwardMessage` services
   gained `authContext` in `28593ed7` (they use it only for the ownership guard;
   `ForwardFromUIOptions` still has no such field). Precedent for the fail-closed
   default is already in the AIO: **G04.AUTH denies outright when `authContext` is
   absent** (`forbidden_no_auth_context`), so a missing context must ENFORCE here
   too — skipping is the bypass.

   **TRAP — a naive reuse of the agent branch DENIES EVERY CROSS-HOST FORWARD.**
   `validateMessageRoute` refuses an unresolved recipient
   (`lib/communication-graph.ts:525` → `Unknown recipient role`), and the AIO
   leaves `recipientTitle = 'unknown'` for anyone absent from the LOCAL registry
   (`send-message-service.ts:294`, "may be remote"). `forwardFromUI` explicitly
   supports remote recipients — `toResolvedLocal || { agentId: '', alias, hostId }`
   — so a remote forward has no title at all. Do not discover this from a broken
   cross-host mesh.

   **CORRECTION (2026-07-10, verified by reading all three call sites).** The
   remedy this section proposed — "resolve the remote title from
   `lib/agent-directory.ts`, as `amp-service.ts` does" — is WRONG on both halves.
   `amp-service` does not do that, and doing it would duplicate a check the
   receiving host already owns.

   The system's cross-host contract is stated at `amp-service.ts:1111-1124`:
   *"We don't know the remote recipient's title, but we CAN check if the sender
   has any allowed recipients at all… The full graph check happens on the
   receiving host."* For a remote recipient it runs only the weak sender-side
   check (`getAllowedRecipients(senderTitle).length > 0`), then POSTs to the
   peer's `/api/v1/route`, which re-enters `routeMessage`, resolves the recipient
   in ITS local registry, and runs the full `validateMessageRoute` at
   `amp-service.ts:1286`. That line sits after the remote-delivery block returns,
   so it is exactly the receiving-host enforcement the comment promises. A peer's
   title lives on the peer's host and changes there; a sender-side copy read from
   `agent-directory` is a stale mirror of an authoritative fact.

   So the remote branch is: **weak sender-side check, deliver, let the receiving
   host enforce.** That is this TRDD's own second option ("scope enforcement to
   local recipients and say so") — now say so.

   **Discovered while verifying it: the two send paths already disagree, and one
   of them denies cross-host.** Only three call sites use `validateMessageRoute`
   (the AIO's two branches and `amp-service:1286`).

   | Path | `skipGraphCheck` for an AGENT sender | Remote recipient today |
   |---|---|---|
   | `POST /api/messages` → `messages-service.ts:289` | **true** (`isSystemOwner \|\| from !== 'user'`) | delivered; R6 never runs — "agents continue to route through AMP for R6-governed messaging" |
   | `POST /api/agents/[id]/messages` → `agents-messaging-service.ts:333` | **false** | **DENIED** — `recipientTitle` is the truthy string `'unknown'`, so the `!recipientRole` fail-closed-to-`member` branch at `:501` never fires and `:526` returns `Unknown recipient role` |
   | AMP `/api/v1/route` → `amp-service.ts` | n/a | delivered after the weak check; receiving host enforces |

   `sendFromUI` DOES deliver cross-host (`lib/message-send.ts:289`), so the
   agent-scoped route's denial is not theoretical — G06 refuses before delivery is
   attempted. Verified by reading; **not yet reproduced by a test**, which the
   suite below must do before the branch is touched. The M2 comment at
   `messages-service.ts:271` fixed this asymmetry in the other direction (a
   production path skipped R38.2 while AMP enforced it); the shared gate is what
   stops it recurring in a third place.

   **BLOCKED ON A POLICY DECISION (escalated, not self-approved).** Forward rewrites
   the new message's `from` to the mailbox owner — an AGENT. So a HUMAN clicking
   Forward in the Message Center emits a message that appears to come from agent X.
   Whose title does the graph then evaluate? R6 exempts the HUMAN (full `Y` to every
   node), but the message's declared sender is X, and X may not be allowed to reach
   the recipient. R6 does not state this case. Deciding it is comm-graph semantics,
   not a mapping — Tier 2. **Recommended split:** ENFORCE for an agent caller (the
   unambiguous half — an agent forwarding must obey the same graph as an agent
   sending; after the ownership fix `fromAgent === caller`), and PRESERVE today's
   behavior (no graph) for a system-owner caller until the USER or MANAGER decides.
   That closes the security hole while inventing no policy.

   **Gate contract (write this, then wire it).** `lib/message-route-gate.ts`

   ```
   assertRouteAllowed({ senderTitle, senderAgentId, to, recipient, authContext,
                        inReplyTo, skip }) -> { allowed, error?, ops[] }
   ```

   | Case | Behavior | Why |
   |---|---|---|
   | `authContext` absent | **DENY** `forbidden_no_auth_context` | G04.AUTH sets the precedent; skipping is the bypass |
   | sender is an agent, recipient resolved LOCALLY | full `validateMessageRoute` | today's G06 agent branch, unchanged |
   | sender is an agent, recipient remote/unresolved | weak `getAllowedRecipients(senderTitle).length > 0` | the AMP contract; receiving host enforces |
   | sender is `user`/`system` (system-owner caller) | preserve today's behavior | the Tier-2 question below — invent no policy |
   | graph module throws | **DENY** `graph_check_unavailable` | SVC2-MAJ-19 fail-closed, preserved |

   Call it from the AIO (replacing G06's body) and from `forwardFromUI`. Two
   callers, one rule — which is the entire point, since a second copy of a
   governance rule diverges. Note `ForwardFromUIOptions` still has no
   `authContext` field; both `forwardMessage` services already carry one
   (`28593ed7`) and use it for the ownership guard, so the plumbing is a parameter,
   not a lookup.

   Regression risk is on the core send path AND the cross-host mesh; it needs its
   own suite. MEDIUM. **Falsify in this order, before touching the branch:** (1) a
   test that reproduces the agent-scoped route's cross-host denial, so the fix has
   something to turn green; (2) a test that a forward from an agent to a recipient
   its title cannot reach is refused, and that the message was never written to any
   `sent/` folder — a denial asserted as a 403 alone would pass on a bypass that
   delivers first.
2. **`agentRegistry.getAgent()` constructs and evicts on read** (`lib/agent.ts:905`)
   — **DONE `03159944`.** Four callers; one legitimately wanted the construct
   (`agent-startup`), one wanted a runtime read (`getSubconsciousStatus`), and two
   (`getSkillSettings`, `saveSkillSettings`) never used the returned Agent at all —
   they wanted an existence check, and because `getAgent` never returns null their
   `404` was dead, so an unknown or soft-deleted agent got a 200. The read accessor
   `getExistingAgent()` already existed. Surfaced a live capacity bug now tracked as
   **TRDD-QC8R79G5**: the LRU cap is 10, there are 18 agents, and startup evicts 8 —
   invisible until the read stopped reloading them.
3. **`element-inventory` POST validation gauntlet** — **DONE `2fd32899`** (cognitive
   34 → 12). Pure refactor. (The `metrics` fix avoided repeating this: its gauntlet
   lives in a pure `parseMetricsUpdate`, after the code-health hook caught
   `updateMetrics` at 38.)

Deciding `amp-init` is what empties `UNREVIEWED_INVENTORY` and closes the parent
**TRDD-4Q7WMPZK**.

**SUPERSEDED — do NOT carry forward.**

- The Part-1 table's `export` row (`POST` / confidentiality) and the "Suggested
  shape" bullet proposing `view-transcript` for it. Written from the route's name
  and its POST handler, without reading `exportAgentZip`.
- The Part-1 table's `messages/[messageId]` row ("`deleteMessageById` etc." /
  integrity of the governance channel) and the `manage-messages` suggested shape,
  including its claim that the delete verb "should almost certainly NOT be
  self-drive". The sharp verb is POST (sender forgery + arbitrary mailbox read),
  no new action was warranted, and self-delete is permitted.
- The Part-1 table's `subconscious` row ("drives another agent's background
  process") and the `drive-subconscious` / `send-command` suggested shape. It
  drives nothing — it returns 400 for every input. The endpoint was deleted; the
  real primitive was the unauthenticated GET's construct-and-evict.
- The Part-1 table's `metrics` row ("low blast radius; data integrity only") and
  the "likely `modify-agent`" suggested shape. An unvalidated string `amount` is
  stored into `estimatedCost`, which the profile UI renders with `.toFixed(2)` —
  a stored, cross-agent denial of view, not a data-integrity nit. And
  `modify-agent` would have denied the endpoint's only caller, exactly as with
  `element-inventory`.
- The `element-inventory` "likely `modify-agent`, but confirm what it writes"
  bullet. Confirmed: it writes an audit ledger, and the action was inverted.
- The Part-1 table's `element-inventory` row ("reconfiguration-adjacent") and the
  `modify-agent` suggested shape. It appends to an audit ledger, and
  `modify-agent` bans self-target — which is exactly what the endpoint's only
  intended caller does. The rule is ownership.

All four are kept below only so the errors stay legible. Note the shape they
share: each was written from a route's name or a function's name, and each named
a capability the code does not have. Two understated the severity, one invented
one, and one would have broken the feature it was meant to secure.

**Tier 2.** Successor to the Tier-0 audit TRDD-4Q7WMPZK, which triaged all ten
agent-scoped routes that authorize nothing, fixed the three that were pure
mappings, and stopped where policy begins.

Nothing here is a new restriction. All five routes are **open today**: any
principal holding any valid agent token can call them against any agent. What is
missing is a decision about who *should* be able to, and every option requires
naming a capability the `AuthAction` union does not yet have.

## Why these could not be fixed in the Tier-0 EHT

Three routes were closed there because the action already existed and the only
question was wiring:

- `chat` POST ends in `sendKeys(literal, enter)` — it **is** `send-command`
  (`c7d9f8a7`).
- `queue/[entryId]` DELETE — `send-command` for the cross-agent case, plus
  ownership for self-target (`4b1a9b48`).
- `email/addresses/[address]` — its three siblings already used `modify-agent`
  (`6c905104`).

The five below reach capabilities the matrix has never modelled: *read another
agent's transcripts*, *delete another agent's messages*, *drive another agent's
subconscious*. Inventing an action is defining policy, so it is proposed.

## Part 1 — the five routes

| Route | Verbs | Reaches | Sharpness |
|---|---|---|---|
| `export` | POST | `createTranscriptExportJob` — any agent's FULL conversation transcripts | **confidentiality**; the highest-value data in the system |
| `messages/[messageId]` | PATCH DELETE POST | `deleteMessageById` etc. on any agent's AMP mailbox | **integrity of the governance channel** — an agent can delete the directives its COS sent it |
| `subconscious` | POST | `triggerSubconsciousAction` on any agent | drives another agent's background process |
| `element-inventory` | POST | writes agent element state | reconfiguration-adjacent |
| `metrics` | PATCH | `updateMetrics` on any agent | low blast radius; data integrity only |

`messages/[messageId]` deserves the sharpest look. AMP is title-gated by the
communication graph — who may *send* to whom is enforced. But who may *delete* a
delivered message is enforced by nothing. That is the same asymmetry that made
`queue/[entryId]` a fleet-wide denial of governance: gating the create verb is
worthless while the destroy verb is open. An agent that cannot be ordered because
it can silently delete its orders is not governed.

Suggested shape, for argument rather than adoption:

- **`view-transcript`** (new) — `export`. MANAGER anywhere, COS in-team, an agent
  on itself, system-owner. Note `view-agent` already exists and is documented as
  "currently open, for future lockdown" — deciding whether transcripts fall under
  it, or need their own action, is part of this proposal.
- **`manage-messages`** (new) — `messages/[messageId]`. The delete verb should
  almost certainly NOT be self-drive, for the reason above. An agent reading its
  own mailbox is fine; an agent deleting a COS directive out of it is not.
- **`drive-subconscious`** (new) or fold into `send-command` — depends on whether
  the subconscious counts as "the agent's own surface".
- `element-inventory` — likely `modify-agent`, but confirm what it writes.
- `metrics` — likely `modify-agent`. If the hook writes it on the agent's own
  behalf, self-drive matters; check the caller before choosing.

## Part 2 — `amp-init` re-mints an agent's own identity keys

`POST /api/agents/[id]/amp-init` does authorize, by hand:

```ts
if (auth.agentId && auth.agentId !== id) {
  if (!isManager(auth.agentId)) return 403
}
```

Correct for the cross-agent case, and it bypasses the matrix entirely — including
the universal self-target ban. So **an agent may re-mint its own AMP identity
keys.** Under TRDD-D3RP7KQZ an agent may drive its own surface and never
reconfigure itself, and an Ed25519 keypair is the sharpest piece of configuration
it has: re-minting it silently invalidates every signature its peers trust.

That reads like a self-reconfiguration the USER's decision already forbids. But it
was written deliberately, so it is raised rather than changed. If it is intended,
it should be an explicit exemption with its reason, not a hand-rolled check that
happens to skip `authorize()`.

## Part 3 — `manage-amp-address` is a dead action

Declared in the `AuthAction` union (SVC2-MAJ-18: "claim or remove an AMP address
on an agent record") and asserted in `tests/authorization.test.ts`'s
`SELF_FORBIDDEN` list. **Wired to zero routes.** All four address routes use
`modify-agent`.

An action that exists only in a test is worse than one that does not exist: it
reads as coverage. Either the four address routes adopt it — a real improvement,
since `modify-agent` is a blunt instrument for an address book — or it is deleted.
Both are one-line changes; choosing between them is the decision.

## Verification

- Each new `AuthAction` gets a matrix test at the `authorize()` boundary, per
  title and per self/other target, in `tests/authorization.test.ts`.
- Each route gets a behavioural suite in the shape of
  `tests/unit/chat-send-authorization.test.ts`, **falsified**: strip the guard and
  confirm the refusal assertions fail. A regression test that passes on the buggy
  code proves nothing, and this session already caught one of its own tests
  passing vacuously.
- `UNREVIEWED_INVENTORY` in `tests/unit/agent-route-authorization-coverage.test.ts`
  shrinks to `[]`, and the guardrail then fails the build if any new agent-scoped
  mutating route ships without an authorization step.

## Estimated risk

MEDIUM. Every option widens a surface from its current authorize-nothing state, so
the direction is tightening; the risk is choosing an action whose matrix is wrong
and having to migrate it later. LOW for `metrics` and `element-inventory`.

The risk of NOT deciding is concrete and current: **`export` and
`messages/[messageId]` are open right now.** Any agent on this host can read every
other agent's transcripts, and delete the messages its COS sent it.

## Approval log

- 2026-07-09T23:34:05+0200 — APPROVED by USER (tier 2), via the batch approval of
  four Tier-2 proposals. Rationale: `export` and `messages/[messageId]` are open
  right now; the standing directive is to prioritize security. Promoted
  `proposal → planned` and moved to `design/tasks/`.
- The proposal poses policy questions rather than answering them. Approval is read
  as a mandate to decide them under the USER's standing rule ("decide yourself,
  base decisions on verified facts, prioritize security"), taking the
  security-conservative fork at each choice and recording each decision here with
  the code that justifies it. Every suggested shape in the body is re-verified
  against the implementation before it is adopted — the body's suggestions are
  hypotheses, not findings.

### Decisions made under that mandate

- 2026-07-09 — `export` → new action `export-agent`, **system-owner only**; every
  agent title denied, MANAGER / COS / self included. The archive carries
  `keys/private.pem`. (`f56b79f2`)
- 2026-07-10 — `messages/[messageId]` and `/api/messages/forward` → **ownership,
  no new action.** `manage-messages` REJECTED (it would duplicate the mailbox
  authorization this codebase already performs, exactly as `manage-amp-address`
  would have for the address book). Self-delete PERMITTED. MANAGER and COS denied
  another agent's mailbox. Rationale and the code that justifies each half are in
  the STATE block. (`28593ed7`)
- 2026-07-10 — `subconscious` → **no action; POST DELETED.** `drive-subconscious`
  REJECTED: the function returns 400 for every input, has zero callers, and is
  self-described legacy compatibility. Authorizing a dead primitive is theatre;
  deleting it removes the attack surface. The GET (previously unauthenticated)
  takes the same ownership rule as the mailbox. (`505ae8c9`)
- 2026-07-10 — `element-inventory` → **ownership; `modify-agent` REJECTED as
  INVERTED.** That action bans self-target, and the endpoint's only intended
  caller is an agent posting its own inventory, so it would have been permanently
  uncallable. Authorized rather than deleted, because unlike
  `triggerSubconsciousAction` the writer works and its reader is live: **an
  unfinished feature gets a guard; a dead one gets deleted.** (`1ad04ade`)
- All four decisions took the security-conservative fork where the evidence was
  ambiguous, and the LESS restrictive fork (self-delete) only where a shipped
  sibling already permitted it — because a restriction on one path that its twin
  does not carry is not a restriction, it is a detour.
- Three of the four ended with **fewer** concepts than proposed (no
  `view-transcript`, no `manage-messages`, no `drive-subconscious`, no
  `modify-agent`; one endpoint removed outright). Exactly one new action was
  warranted in the whole TRDD: `export-agent`. A proposal that asks "which new
  capability should this have?" has already presupposed it needs one.
