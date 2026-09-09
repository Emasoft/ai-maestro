---
trdd-id: W11LAPSC
title: a no-refresh live blob thrashes once per tick because 403 is treated as credential death and networkUp stays true
column: proposal
created: 2026-09-09T16:35:13+0200
updated: 2026-09-09T16:41:06+0200
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

**THE DESIGN HALF HAS ALREADY CHANGED ONCE, on the day this card was filed — treat it as
UNSETTLED.** It was filed with a body-read discrimination; that was withdrawn hours later by the
session that proposed it, and replaced with the slot-type gate now in Proposed design. The
acceptance boxes changed with it.

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

**SUPERSEDED 2026-09-09 16:41 — the design THIS CARD WAS FILED WITH, summarised in this
paragraph, is withdrawn. It is not the design in the bullets underneath.** That original gated
stay-put on distinguishing `oauth_scope_insufficient` from other 403s, which required widening
the janitor's `usage_probe.http_get` to return the error body (it currently discards it). It was
proposed by the janitor session, recorded here as AGREED between both sessions, and withdrawn by
them the same day — and it was never independently established on this side either. Their stated
grounds: a corrupted-bearer-token control returned **401 `authentication_error`, not 403**, so
credential death already surfaces as 401, which is fatal on both sides.

**The design now on the table — key on SLOT SHAPE, not on the response body:**

- the gate keys on **absence of `refreshToken` in the blob**. That is a MARKER for a
  `claude setup-token` mint, not a definition of one: any other path that lands a blob without a
  refresh grant (a capture that never persisted one, a partial write that dropped it) inherits
  the same leniency. Keying on it is a deliberate trade, not an identity;
- for such a slot a 403 on `/usage` is EXPECTED (the mint has no `user:profile` scope) and must
  NOT mark it dead;
- **401 stays fatal for every slot type**, unchanged;
- a **full-OAuth** slot keeps BOTH 401 and 403 fatal, unchanged — the leniency reaches exactly
  the credential class that cannot be measured;
- "unmeasurable" stays distinct from "near limit". A probe that cannot answer is not evidence of
  exhaustion;
- if such slots ever become admissible TARGETS they need their OWN bucket, tried AFTER
  `degraded`, never inside it — reusing `degraded` reproduces the max-expiry inversion
  TRDD-WLHP34KZ is about.

**The unread fact both gates rest on.** Neither session has read the blob shape this gate keys
on. All 3 slots in this vault record `via: slot_capture_browser(full-oauth)`; no setup-token blob
has ever been held here, and the janitor's importer has not been read on this side. If it writes
`refreshToken` absent, `null` or `""`, `oauthOf(b).refreshToken` is falsy and the gate fires. If
it writes a placeholder string, or nests the field differently, **this gate and TRDD-WLHP34KZ's
both silently never fire — and both cards still read as correct.** That is the
highest-probability failure in the pair and it is one grep of their importer away.

REPORTED, not measured here (janitor session, 2026-09-09): the 401-not-403 control, and that they
are implementing the slot-type gate on their side. **The generalisation is from ONE sample**, and
a weak one: a CORRUPTED bearer token returning `authentication_error` is close to tautological —
a malformed token authenticates as nothing. It says little about a well-formed but no-longer-
authorized credential, which is what revocation and account suspension look like.

What would FALSIFY the "they are implementing it" half: read the janitor's own rotator for a
`refreshToken is None` branch on its 403 path. Until then, assume neither side has shipped it.

**The trade, stated without consolation.** If the generalisation is wrong — if a revoked
no-refresh credential answers 403 rather than 401 — this change converts a working rotation into
a permanent pin on a dead live credential, for as long as it stays live, while healthy alternates
idle and the tick logs a deliberate hold that looks correct. Today's behaviour would instead
rotate away and keep the user working. Recovering the *credential* needs a human re-mint either
way; recovering *service* is the rotator's entire job, and that is what the pin costs. The
exposure is accepted only because no no-refresh slot exists in this vault today.

Note the pair is a one-way door: TRDD-WLHP34KZ forbids rotating ONTO a no-refresh slot, and this
card forbids rotating OFF one. A no-refresh credential that becomes live by any route (a manual
`/login`, an import) has exactly one exit — a 401.

## Verification (when it is authorised)

A test seeding a live blob with **no `refreshToken`** whose `/usage` probe returns a bare 403 (no
body inspection — the gate no longer reads one), driving two consecutive ticks, asserting ZERO
`switchLiveTo` calls
across both. It must FAIL before the fix — the current code rotates on the first tick — and the
two-tick shape is what distinguishes "stayed put" from "rotated once and had nowhere to go".

A second case must assert the fix did not disarm the real failure, and under slot-type gating
that case is a different one than it was under the withdrawn design: a **full-OAuth** live blob
(refresh grant present) whose probe returns 403 must still rotate, unchanged. A third asserts 401
stays fatal for a no-refresh blob — the one exit from the one-way door named above.

## Risk

MEDIUM, higher than TRDD-WLHP34KZ's. That card's change only ever removes candidates; this one
makes the tick decline to rotate where it currently rotates, so a mistake keeps a genuinely dead
live credential in place while healthy alternates idle.

NOT a smaller risk than the withdrawn body-read design — a DIFFERENT one, and the card should not
be quoted as saying otherwise. The body-read design consumed more information (the server's own
reason) and its exposure was body-format instability. This one is cheaper, touches no shared
frozen contract, and carries two exposures instead: a structural proxy that may not identify the
class it stands for, and the unmeasured 401-only generalisation.

## Acceptance

- [ ] owner rules — including the option to close this as subsumed by TRDD-WLHP34KZ's gate
- [ ] the janitor importer's blob shape READ, confirming `oauthOf(b).refreshToken` is actually
      falsy for an imported setup-token — if it writes a placeholder, this gate and
      TRDD-WLHP34KZ's both silently never fire
- [ ] confirm 401-not-403 for a death mode other than a corrupted bearer token, **or the OWNER
      accepts the residual permanent-pin exposure on the record** (this box gates the SHIP, not
      a sentence: it is not satisfiable before the branch exists)
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
