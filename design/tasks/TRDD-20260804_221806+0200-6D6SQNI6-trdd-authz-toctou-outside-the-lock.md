---
trdd-id: 6D6SQNI6
title: TRDD authorization is computed outside the document lock the write then takes
column: todo
created: 2026-08-04T22:18:06+0200
updated: 2026-08-04T22:18:06+0200
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: security
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: governance-rules
approval-datetime: 2026-08-04T22:18:06+0200
derived: false
npt: []
eht: []
blocked-by: []
priority: 1
severity: high
effort: medium
release-via: none
labels: [pillar-tooling, concurrency, authorization, toctou]
---

# TRDD authorization is computed outside the document lock the write then takes

## Problem

`authorizeTrddVerb` (`lib/trdd-authz.ts:105`) reads the card to decide whether the caller may
perform a verb. It is invoked at ROUTE level — `app/api/trdd/[id]/archive/route.ts:61`,
`promote/route.ts:50`, `approve/route.ts`, and the other lifecycle routes — and **`lib/trdd-authz.ts`
takes no lock at all** (measured: zero occurrences of `withDocumentLock` / `documentLockKey` /
`withJsonLock` in the file). The write that follows then takes the document lock.

So the sequence is: read the card unlocked → decide → acquire the lock → write. A peer that
changes `assignee` or `min-approval-requirement` inside that window lets the mutation land on an
authorization computed against a state that no longer exists.

## Root cause

Classic TOCTOU, but with a specific aggravating factor worth stating: **TRDD-D7KVF4HQ added the
document lock, and its presence makes these writes LOOK protected.** The lock is real and it does
serialise the writes; it simply does not extend back over the decision that authorised them. A
reader auditing this code sees a lock and stops looking — which is why this survived the pass that
introduced the lock, and the pass after it.

The window is small and the exploit is not casual: it needs a concurrent governance edit landing
between two steps of one request. But the whole reason authorization exists on these verbs is that
a card's `assignee` and approval floor decide who may move it, and those are exactly the fields a
racing writer would be changing.

## Proposed fix

Move the authorization inside the lock, so decide-and-write is one critical section. Concretely,
one of:

1. **Push the lock up to the route** — take `documentLockKey(id)` before `authorizeTrddVerb`, hold
   it across the store call. Simplest to reason about, and it makes the critical section visible at
   the call site. Cost: the lock is held across more work, and the store's own acquisition must
   then be reentrant (verify it is — the pillar lock was made reentrant for a reason; if it is not,
   this deadlocks).
2. **Push the authorization down into the store**, so the verb functions authorise under the lock
   they already hold. Better encapsulation, but it moves policy into the store layer, which is
   currently mechanical.
3. **Re-validate under the lock** — authorise optimistically, then re-read and re-check the two
   decisive fields after acquiring it, refusing on a change. Least restructuring, and it is the
   same compare-and-swap idea `lib/pillar/edit.ts` already applies to content.

Option 3 is the closest fit to the machinery that already exists here, and it is the one to
measure first. Whichever is chosen, it spans five routes, which is why the review pass that found
it declined to half-do it.

## Verification

- A test that interleaves deterministically: hold the document lock, start the authorised verb in
  a SIBLING async context so it contends, mutate `assignee` while it waits, release, and assert
  the verb REFUSES. Starting the contender inside the holder's callback would inherit the held
  lock (the pillar lock is reentrant) and the test would prove nothing.
- Positive control in the same test: with no interleaving, the same verb SUCCEEDS. Without it,
  "it refused" is equally satisfied by a change that refuses everything.
- Neuter: revert the fix and confirm the interleaved case passes again.

## Estimated risk

**MEDIUM to fix** (five routes, and option 1 risks deadlock if the lock is not reentrant),
**MEDIUM to leave** — the window is narrow, but the fields it races on are precisely the ones that
decide authority, and the visible lock makes the gap invisible to review.

## Provenance

Found by the second `/code-review high --fix` pass on 2026-08-04 (finding #8 of 15), which
deliberately skipped it and flagged it rather than restructuring request handling inside a fix
round. Re-verified first-hand before this card was written: the call sites and the absence of any
lock in `lib/trdd-authz.ts` were both measured, not taken from the report.

## Approval log

- 2026-08-04T22:18:06+0200 — MANDATE (self). Tier 0: confined to this repo's own routes and
  store, no baseline deviation, no cross-team or release surface.

## Acceptance

- [ ] the option is chosen by MEASUREMENT — in particular, whether the pillar document lock is
      reentrant, since option 1 deadlocks if it is not
- [ ] decide-and-write is one critical section across all five lifecycle routes
- [ ] the deterministic interleaving test exists, with its positive control and a recorded neuter
- [ ] the chosen shape is documented at `authorizeTrddVerb` itself, so the next reader learns that
      the lock's presence downstream does NOT cover this decision
