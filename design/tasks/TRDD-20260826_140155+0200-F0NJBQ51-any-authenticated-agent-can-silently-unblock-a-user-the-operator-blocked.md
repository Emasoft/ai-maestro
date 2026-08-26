---
trdd-id: F0NJBQ51
title: Any authenticated agent can silently unblock a user the operator blocked on the host vpn-chat blocklist
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:01:55+0200
updated: 2026-08-26T14:01:55+0200
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

- [ ] Enumerate every caller of POST and DELETE (count before reading; never `head` an absence sweep)
- [ ] Ruling recorded here on which principal may block, and which may unblock
- [ ] Guard implemented per the ruling, mirrored in the headless twin if one exists
- [ ] Refusal test + neuter recorded, asserting the FILE did not change
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
