---
trdd-id: W11LAPSC
title: a no-refresh live blob thrashes once per tick because 403 is treated as credential death and networkUp stays true
column: proposal
created: 2026-09-09T16:35:13+0200
updated: 2026-09-09T16:35:13+0200
current-owner: unassigned
created-by: governance-rules-session
assignee: unassigned
task-type: bugfix
min-approval-requirement: user
approved: false
labels: [oauth-rotator, continuity, setup-token]
external-refs: [TRDD-WLHP34KZ, TRDD-RE9AVNJF, TRDD-8148P30S]
---

# a no-refresh live blob thrashes once per tick because 403 is treated as credential death and networkUp stays true

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

NOT STARTED. No code written. Split out of TRDD-WLHP34KZ 2026-09-09 on a review finding: that
card is about a target-RANKING inversion, this one is a rotation LOOP. They share a trigger (a
credential with no refresh grant) and nothing else, and keeping both under one set of acceptance
boxes made it ambiguous which half a box covered.

**Reachability is CONDITIONAL on TRDD-WLHP34KZ.** This loop needs a no-refresh slot to have
already become an admissible rotation TARGET. If WLHP34KZ's gate is applied, no such slot ever
reaches `degraded`, and this defect is unreachable by that route. It is filed anyway because the
gate is one line in one arm and this is the failure mode if that line is ever relaxed, or if such
a slot becomes the LIVE credential by another path (a manual `/login`, an import).

NEXT ACTION: owner decides — and may reasonably decide it is subsumed by WLHP34KZ's gate and
close this as such. That is a legitimate outcome, not a failure of the card.

## Problem

VERIFIED FIRST-HAND in this repo 2026-09-09 (`lib/oauth-rotator/tick.ts`):

`:1171` treats 401 and 403 identically as credential death:

    } else if (liveStatus === 401 || liveStatus === 403) {
      near = true
      liveDesc = `token REJECTED (HTTP ${liveStatus}) — expired/invalid`

`near = true` is what makes the tick look for a rotation target.

`:1090` is `const networkUp = liveStatus !== 0 || liveOutcome.reason !== 'error'`. On a 403 the
first disjunct is already true, so `networkUp` stays TRUE — the tick believes the API is
reachable and that it has a real credential failure.

Both readings are correct for an expired token and wrong for a scope gap. A credential minted by
`claude setup-token` is inference-scoped: it 403s on `/api/oauth/usage` because it lacks
`user:profile`, while remaining perfectly valid for inference. The tick cannot tell the two
apart, so it reads "healthy token, unusable endpoint" as "dead credential, rotate now".

The loop: rotate onto such a slot, next tick probes it, 403, `near = true`, rotate off — one real
`Claude Code-credentials` write per tick, indefinitely, converging on nothing because every
candidate in that state is equally unmeasurable.

NOT MEASURED: the loop has not been observed running. It is derived from the two readings above
plus the documented 403 behaviour of a setup-token, and no such slot exists in this vault today
(all 3 record `via: slot_capture_browser(full-oauth)`).

## Proposed design

AGREED BY DESIGN 2026-09-09 between this session and the janitor session, **NOT IMPLEMENTED on
either side**. When the LIVE blob has no refresh token, the tick STAYS PUT unless it has positive
evidence of failure:

- distinguish `oauth_scope_insufficient` from other 403s — the latter stay fatal;
- treat "unmeasurable" as distinct from "near limit". A probe that cannot answer is not evidence
  of exhaustion;
- if such slots ever become admissible TARGETS, they need their OWN bucket, tried AFTER
  `degraded` — never inside it, because reusing `degraded` reproduces the max-expiry inversion
  TRDD-WLHP34KZ is about.

What would falsify the agreement half: read the janitor's own rotator for a scope-aware 403
branch. Until then assume neither side has shipped it.

## Verification (when it is authorised)

A test seeding a live blob with no refresh grant whose `/usage` probe returns 403 with a
scope-insufficient body, driving two consecutive ticks, asserting ZERO `switchLiveTo` calls
across both. It must FAIL before the fix — the current code rotates on the first tick — and the
two-tick shape is what distinguishes "stayed put" from "rotated once and had nowhere to go".

A second case must assert the fix did not disarm the real failure: a 403 that is NOT
scope-insufficient still rotates.

## Risk

MEDIUM, higher than TRDD-WLHP34KZ's. That card's change only ever removes candidates; this one
makes the tick decline to rotate in a case where it currently rotates, so a mistake here keeps a
genuinely dead live credential in place. The `oauth_scope_insufficient` discrimination is the
whole safety margin, and it depends on the endpoint's error body being stable — which has not
been verified against a live 403 on this side.

## Acceptance

- [ ] owner rules — including the option to close this as subsumed by TRDD-WLHP34KZ's gate
- [ ] the scope-insufficient 403 discrimination read from a real response body, not assumed
- [ ] stay-put branch implemented for a no-refresh LIVE blob
- [ ] both tests above written and passing; the first FAILS before the fix
- [ ] janitor told which side shipped what, so the agreement stops being an intention

## Approval log

- 2026-09-09T16:35:13+0200 — Authored as a PROPOSAL, split out of TRDD-WLHP34KZ. NOT
  self-mandated. By `aimaestro-trdd-approval` §D3 the objective floor is `none` (in-scope
  bugfix). Declared `user` — declared ≥ floor is conformant — because the design half is a
  cross-repo agreement with the janitor and the owner is the decision-maker on that coordination,
  not because the change itself touches a shared credential. (That second, wrong rationale was
  recorded on the sibling card and corrected there the same day.)
