---
trdd-id: 7FTV9MTY
title: Re-land the endpoint-unreachable statusline rotation behind a debounce and a statusline-specific dwell
column: backburner
scope: project
project-id: ai-maestro
created: 2026-08-02T15:14:30+0200
updated: 2026-08-02T15:14:30+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T15:14:30+0200
severity: medium
effort: medium
relevant-rules: [R16]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth, rotator, statusline, continuity]
---

# Re-land the endpoint-unreachable statusline rotation behind a debounce and a statusline-specific dwell

## Why this exists as its own card

[[GY0LJV6S]] shipped `d17fffbd` with TWO statusline wirings inside `autoRotate` and reverted both in
`3c9a7493`. **The two reverts were DIFFERENT judgements and must not be collapsed:**

| branch | verdict | re-landable? |
|---|---|---|
| `liveStatus === 200` disjunct | **UNSOUND, permanently.** `usageRequest` with the live token just returned ground truth for the exact two windows the statusline carries, so on disagreement the statusline is wrong BY CONSTRUCTION. It can never add a TRUE reason there. | **No.** Closed. No debounce fixes a source that cannot legitimately override the answer already in hand. |
| endpoint **UNREACHABLE** | Genuinely ADDITIVE — the endpoint said nothing, so the statusline is the only signal, and "we cannot reach the usage API" is not a reason to keep billing a maxed account. | **Yes — this card.** |

GY0LJV6S's box 1 is closed as REFUSED-AS-WRITTEN, and this card carries the one half that survives,
so a genuinely open piece of work is not buried inside a closed card's checklist.

## What must be built

Restore the `else if (sl.near)` arm ahead of the unconditional stay-put in `autoRotate`, gated by
BOTH of:

1. **`sl.near` sustained across ≥2 CONSECUTIVE ticks**, mirroring `LIVE_429_DEBOUNCE` — which exists
   for precisely this "one bad sample must not rotate" reason. Needs its own streak counter in
   `RotatorState`, reset on any admissible below-threshold reading and on a switch.
2. **A statusline-specific dwell, well above `MIN_DWELL_S` (60 s).**

## Why both, and why neither alone is enough

The branch inherits the misattribution the whole card fought: the ingest stamp records who was live
at ARRIVAL, not who produced the report, so a session still holding the OLD credential after an A→B
switch keeps reporting A's ~98 % and passes both admissibility guards. On this branch that is WORSE
than on the 200 branch, because with the usage API down **every candidate is unevaluable too** — so
the rotation goes out blind on the `degraded` path (most-runway-first) and can walk the whole fleet
one dwell window at a time instead of stalling on one account.

**`MIN_DWELL_S` is not the backstop it looks like.** `last_switch_at` is written ONLY inside
`switchLiveTo` (`rotate.ts:44`), so a rotation that finds no candidate leaves the dwell untouched and
the next tick retries immediately. There is no backoff on the failure path at all. Any re-land that
leans on the existing dwell is leaning on nothing.

## The evidence to gather BEFORE building

The reading is already logged on every tick without actuating (that is what survived `3c9a7493`), so
`5h=10% … [statusline 5h=98% OVER-THRESHOLD]` appears in production logs today. **Read that evidence
first** — it makes the misattribution rate measurable rather than assumed, and it is exactly the
evidence that did not exist when the branch was first wired. Pinned by 3 tests (neuter M3 in
`tests/unit/oauth-rotator-statusline-branches.test.ts`).

## Interaction with the drain-guard — check this before wiring

`drainsLastEscapeHatch` is reachable only from the `liveStatus === 200` path (`expiryOnly` is
assigned nowhere else). A rotation actuated from THIS branch therefore bypasses it entirely, and the
guard's own reasoning does not transfer: with the endpoint down there is no 200 to prove the live
token still works, so the "the expiry is only a prediction" argument is unavailable. Decide
explicitly whether an unreachable-endpoint rotation needs its own last-spare protection; do not
inherit the answer.

## Verification

- The test to INVERT BACK is `oauth-rotator-statusline-branches.test.ts` →
  "stays put when the usage API is down — pending the debounce this branch still lacks". Its comment
  already names itself as the one to flip. When flipped it must assert the DEBOUNCE, not merely the
  rotation.
- Neuter M2 in that file's tail currently reds exactly that test; after the re-land the neuter
  inverts too. Re-measure and rewrite the tail entry — do not leave a stale record.
- A single at-threshold reading must NOT rotate. Two consecutive must.
- A reading stamped with a non-live fingerprint must never advance the streak.

## Acceptance

- [ ] the streak counter lives in `RotatorState`, resets on a below-threshold admissible reading AND on a switch
- [ ] a statusline-specific dwell, distinct from and larger than `MIN_DWELL_S`, with the reason recorded
- [ ] the drain-guard interaction is explicitly decided and written down, not inherited
- [ ] the inverted test is flipped back and asserts the debounce; the neuter tail is re-measured
- [ ] production evidence on the misattribution rate was read BEFORE building, and quoted here
- [ ] tests + at least 2 measured neuters recorded BY NAME; `tsc` 0

## Approval log

- 2026-08-02T15:14:30+0200 — SELF-MANDATE (Tier 0). Derived from [[GY0LJV6S]]'s revert, entirely
  inside the assignee's own scope, no baseline/governance/release surface. Authored directly in
  `design/tasks/` at `backburner` — deliberately NOT `todo`, because the evidence-gathering step
  above should precede scheduling.
