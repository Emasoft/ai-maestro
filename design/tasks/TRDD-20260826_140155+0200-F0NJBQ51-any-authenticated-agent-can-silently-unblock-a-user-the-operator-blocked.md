---
trdd-id: F0NJBQ51
title: Any authenticated agent can silently unblock a user the operator blocked on the host vpn-chat blocklist
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:01:55+0200
updated: 2026-08-26T14:31:40+0200
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
priority: 1
severity: moderate
labels: [security, moderation, route-authz]
external-refs: [TRDD-R268J32X]
---

## Problem

`app/api/vpn-chat/block` has clean hygiene and the wrong principal. All three methods call
`enforceAuth` first and the body is a `.strict()` zod schema with a bounded `userId` — **the
finding is the RESOURCE, not the route.**

`lib/vpn-chat-log.ts` exposes `getBlocklist(stateDir?)`, `addBlock(userId, stateDir?)` and
`removeBlock(userId, stateDir?)`. **None takes a principal.** There is exactly ONE host-level
blocklist, so any authenticated agent mutates the whole host's moderation state.

**The dangerous direction is DELETE.** An agent can silently UNBLOCK someone the operator blocked.
The module header notes *"the blocked user is never notified"* — and by the same design the
**operator is not notified of an unblock either**, so a protective control can be removed with no
signal to the person who set it.

### The writes are real — checked, not assumed

Verified 2026-08-26 after `export/jobs/[jobId]` turned out to be two 501 stubs whose "disclosure"
I had read off a return type. These are not stubs:

```ts
export function addBlock(userId: string, stateDir?: string): void {
  const blocked = getBlocklist(stateDir)
  if (blocked.includes(userId)) return
  blocked.push(userId); saveBlocklist(blocked, stateDir)      // persists
}
export function removeBlock(userId: string, stateDir?: string): void {
  const blocked = getBlocklist(stateDir)
  const idx = blocked.indexOf(userId)
  if (idx < 0) return
  blocked.splice(idx, 1); saveBlocklist(blocked, stateDir)    // persists
}
```

`getBlocklist` reads the file (`:170-176`). The state is durable, host-wide, and shared.

## ⚠ ENUMERATION DONE 2026-08-26 — AND IT INVERTS THIS CARD: **nothing enforces the blocklist**

The acceptance box asked for a caller enumeration. It produced two answers, and the second one is
larger than the finding this card was filed for.

**1. Callers of the route: NONE outside the route itself.** No UI, no CLI, no headless twin —
`grep -c vpn-chat services/headless-router.ts` = **0**, against a control of **2** for
`conversations/parse`, so the needle can see a twin when one exists. Only `app/api/vpn-chat/block/
route.ts`, `lib/vpn-chat-log.ts` and `tests/vpn-chat.test.ts`. Whatever ruling is made, it breaks
nothing.

**2. THE BLOCKLIST IS NEVER READ BY ANY ENFORCEMENT PATH.** Swept `getBlocklist` across
`*.ts|*.mjs|*.js`, whole tree:

```
app/api/vpn-chat/block/route.ts:28   const blocked = getBlocklist()      <- the GET, listing it
lib/vpn-chat-log.ts:197, :207        internal, inside addBlock/removeBlock
tests/vpn-chat.test.ts               ×5
```

**One production reader, and it is the endpoint that displays the list.** The chat path exists and
does not consult it — `app/api/v1/mesh/chat/route.ts:12` imports exactly
`appendMessage, getMessages` from that same module, and **not** `getBlocklist`. An inbound mesh
message from a blocked user is appended like any other.

So the blocklist is **write-only state**. Blocking a user changes a JSON file and changes nothing
else.

**This is the third instance today of one class** — after `export/jobs`' 501 stubs and
`lastRunSummary`'s unconditional `updated` (TRDD-FFHZM7XV): *a mechanism whose existence was read
from its name and its storage, never from a consumer.* I filed this card having verified the
WRITES were real and never asked who READS.

### What that does to the severity

**DOWN for the reported finding, UP for the system.** An unauthorized unblock removes a control
that was not controlling anything, so the disclosure/abuse impact today is ~nil — the authz gap is
real and currently inert. But **the operator has a Block button that does nothing**, and believes
otherwise. A moderation control that silently fails open is worse than an absent one, because it
is relied upon.

`severity` accordingly stays `moderate` but the card's SUBJECT changes: the authz question is now
secondary to *"is this feature finished, and if not, should the endpoint exist at all?"*

## Why this is NOT the `export/jobs` shape

`export/jobs/[jobId]`'s DELETE lacks an **ownership** check — there is an owner to compare against
once its store exists. Here there is no owner field and there should not be one: **a blocklist is
host policy, not per-agent state.** So the fix is not an ownership comparison. It is a PRINCIPAL
question, which is why this is filed as a ruling rather than patched.

## Proposed fix — a RULING

1. **`enforceSystemOwner` on POST and DELETE, GET left readable.** Blocking is a human moderation
   act. This is the shape I would argue for: agents may need to *see* whether a user is blocked;
   nothing suggests an agent should *decide* it.
2. **Or owner-only on DELETE alone**, leaving POST (block) open to agents. Defensible if an agent
   is expected to block abusive input autonomously — a genuine product question, not a security
   one. Note the asymmetry is the whole point: adding a block is fail-safe, removing one is not.
3. Anything that only validates `userId` harder is NOT a fix — the schema is already `.strict()`
   and the input was never the problem.

**Caller enumeration is the first step and must not be guessed** — the same step that made
`RC33OAFQ` and `NWTTU0AQ` cheap to rule on, and that a `head` on an absence sweep got wrong once
already (recorded on `RC33OAFQ`).

## Verification

- A test driving DELETE with an agent token → **refused**, with a neuter proving it reddens.
- POSITIVE CONTROL: the operator can still block and unblock.
- Assert the blocklist FILE is unchanged on the refusal path — a 403 returned after
  `saveBlocklist` has run is still an unblock.
- `tests/unit/agent-route-authorization-coverage.test.ts`: this route sits in
  `NON_AGENTS_AUTHN_ONLY`. Raising the guard makes `STRONG_AUTHZ` match the FILE, so the ledger
  entry must be removed in the SAME commit — R268J32X's own acceptance box records a 30-minute red
  suite from exactly that oversight.
- Check the headless twin before assuming there is none (TRDD-8Q5EVGV1: a Next-side-only fix is
  half a fix wherever a twin exists).

## Acceptance

- [x] **Enumerate every caller — DONE 2026-08-26. ZERO outside the route (no UI, no CLI, no
      headless twin; control: `conversations/parse` = 2 hits in the router, `vpn-chat` = 0). Any
      ruling breaks nothing.** The same sweep found the larger thing — see the ENFORCEMENT section
- [ ] **DECIDE FIRST: is the feature finished?** The blocklist has ONE production reader (its own
      GET) and the chat path does not consult it. Ruling on the principal for a control that
      enforces nothing may be the wrong order of business
- [ ] Ruling recorded here on which principal may block, and which may unblock — **secondary to
      the box above; an authz gap on an inert control is real but currently harmless**
- [ ] Guard implemented per the ruling, mirrored in the headless twin if one exists
- [ ] Refusal test + neuter recorded, asserting the FILE did not change
- [ ] If the feature IS to be finished: an enforcement test proving a blocked sender is REJECTED by
      `v1/mesh/chat`, with a neuter — the check that would have caught this at write time
- [ ] Operator positive control still green
- [ ] Ledger updated in the SAME commit if the guard becomes STRONG_AUTHZ

## Approval log

- 2026-08-26T14:01:55+0200 — FILED, `min-approval-requirement: manager`. Decided during the
  TRDD-R268J32X ledger pass on 2026-08-26 and **deliberately held back that day** as triage: three
  p0 security cards from the same pass were already waiting on the owner and this one is materially
  less severe. Filed now because the batch grew anyway (TRDD-V2BLADSF became a fourth) and the
  evidence was already complete — **a finding that lives only in another card's prose is not on the
  board**, which is the stale-reference failure this corpus keeps catching. Reasoning is unchanged
  from the R268J32X `## Decisions` entry; the write-is-real check above is new.
