---
trdd-id: W4T70Y3R
title: The usage endpoint is polled every 60s with no 429 back-off, and a 429 is read as meaning
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-02T22:48:51+0200
updated: 2026-08-02T22:48:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T22:48:51+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth-rotator, rate-limit, resilience]
external-refs: [Emasoft/ai-maestro#94]
---

# The usage endpoint is polled every 60s with no 429 back-off, and a 429 is read as meaning

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

Surfaced while answering `#94` (AgentlensPro's measured rotation findings). Their finding 1 specifies
a 429 discipline for `api/oauth/usage`; we implement **none of it**, and we additionally assign the
status code a *semantic* meaning that makes the omission worse.

```bash
grep -nE "429|Retry-After|backoff|cooldown|ttl" lib/oauth-rotator/network.ts
# → only the semantic reading. No TTL cache, no Retry-After, no back-off, no lock.
```

**NEXT ACTION:** implement the back-off in `lib/oauth-rotator/network.ts` around `usageRequest`,
preserving the existing semantic reading for a *legitimate* 429 while no longer re-knocking into a
re-armed lockout.

## Why this is not cosmetic

Two facts compose badly:

1. **`usageRequest` reads 429 as "this account is maxed"** (`network.ts:175`) — a deliberate,
   documented design, because that is what a real quota 429 means for a rotation decision.
2. **The tick beats every 60 s.** So a rate-limited account is re-asked ~60 times an hour, and
   AgentlensPro measured that re-knocking **RE-ARMS the lockout rather than queueing**.

Consequence: a transient rate-limit becomes self-sustaining, and because of (1) it does not present
as a rate-limit — it presents as *the account being full*. `network.ts:22-26` already records the
extreme version of this for a UA-banned 429: the LIVE account looks maxed and every alternate looks
unsafe in the same instant, so nothing is rotatable and nothing is actually wrong.

## What #94 specifies (their measured recipe, credited)

- a TTL cache (they use 10 min);
- honour `Retry-After` (delta-seconds **or** HTTP-date), then Anthropic's
  `anthropic-ratelimit-unified-reset` / `-unified-5h-reset` / `-requests-reset` / `-tokens-reset`
  (epoch **or** ISO);
- otherwise exponential back-off doubling per **consecutive** 429, 10 min → 2 h cap;
- a **cross-process lock** around fetch+cooldown **with a re-check after acquiring** — two callers
  can both pass the cooldown check before either fires, double-hit, and then, reading the same
  consecutive count, fail to escalate.

That last clause is the subtle one and is the reason to copy the recipe rather than re-derive it.

## The distinction the fix must preserve

A 429 currently carries information the rotator needs. The fix must separate:

- **quota 429** — the account really is maxed → keep today's meaning;
- **rate-limit 429** — we asked too often, or with a bad UA → back off, and report the reading as
  unavailable rather than as "maxed".

Collapsing these is what makes today's behaviour wrong; a fix that simply adds back-off and keeps one
interpretation would still mislabel a throttle as an exhausted account. `#94` also recommends
reporting *why* a reading resolved as it did (`fresh | cooldown | 429 | lock_contended | …`) instead
of re-deriving it afterward, which is the shape that keeps the two apart.

## Verification

```bash
grep -nE "Retry-After|backoff|consecutive|cooldown" lib/oauth-rotator/network.ts   # must be non-empty
yarn test tests/unit/oauth-rotator-*.test.ts
```

A test must pin BOTH directions, and neither is provable by asserting only that a 429 was seen:
a quota 429 still yields "maxed", and a throttle 429 yields "unavailable" + a back-off — with a
neuter that shows removing the back-off reddens only the second.

## Estimated risk

MEDIUM. It touches the credential path's decision input, and getting the split wrong turns a
throttle into a false "account exhausted" — which is precisely today's bug, so a careless fix
reproduces it. No behaviour change for the 200 path.

## Acceptance

- [ ] TTL cache on the usage reading, with the staleness surfaced rather than rendered as live
- [ ] `Retry-After` honoured (both encodings), then the `anthropic-ratelimit-*-reset` headers (both encodings)
- [ ] exponential back-off per CONSECUTIVE 429, capped
- [ ] cross-process lock with a re-check AFTER acquiring
- [ ] quota-429 and throttle-429 produce different rotator-visible outcomes, each pinned by a test
- [ ] a neuter run recorded showing which test each guard alone reddens

## Approval log

- 2026-08-02T22:48:51+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix inside the
  authoring agent's own scope; no baseline deviation, no cross-team reach, reversible. Sourced from
  `Emasoft/ai-maestro#94`; no approval request was sent.
