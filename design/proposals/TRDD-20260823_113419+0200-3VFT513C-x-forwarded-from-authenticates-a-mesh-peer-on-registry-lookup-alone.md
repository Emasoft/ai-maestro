---
trdd-id: 3VFT513C
title: X-Forwarded-From authenticates a mesh peer on registry lookup alone and the signature header is never read
column: proposal
created: 2026-08-23T11:34:19+0200
updated: 2026-08-23T11:40:00+0200
current-owner: ai-maestro-00
created-by: ai-maestro-00
task-type: security
min-approval-requirement: manager
approved: false
npt: []
eht: []
project-id: ai-maestro
repo: Emasoft/ai-maestro
relevant-rules: []
external-refs: []
---

# X-Forwarded-From authenticates a mesh peer on registry lookup alone and the signature header is never read

## Problem

`services/amp-service.ts::routeMessage` (the handler behind `POST /api/v1/route`) authenticates a
mesh-forwarded request on the strength of a **caller-controlled header naming a known host id**,
with no cryptographic check on that claim. Measured 2026-08-23 by reading the function:

```ts
let auth = authenticateRequest(authHeader)
if (!auth.authenticated && forwardedFrom) {
  const forwardingHost = getHostById(forwardedFrom)
  if (forwardingHost) {
    auth = { authenticated: true, agentId: `mesh-${forwardedFrom}`, … }
```

Three facts, each verified first-hand:

1. **Registry membership IS the authentication.** `getHostById(forwardedFrom)` resolving is the
   entire test. `X-Forwarded-From` is supplied by the caller.
2. **The Ed25519 check is OPTIONAL and does something else.** `verifyRoleAttestation` runs only
   `if (attestationHeaders?.senderRoleAttestation && forwardingHost.publicKeyHex)`, and it upgrades
   the sender ROLE. When the attestation is absent the branch is skipped; when it is INVALID the
   code logs `Invalid role attestation … — ignoring` and continues with `authenticated: true`.
   So it never gates authentication — only which role the authenticated caller is credited with.
3. **`X-AMP-Signature` is never read.** It is threaded into `routeMessage` as `signatureHeader`
   and `grep -n 'signatureHeader' services/amp-service.ts` returns exactly ONE line: the parameter
   declaration itself. Accepted and discarded.

`POST /^\/api\/v1\/route$/` is correspondingly listed in `UNGUARDED_LEDGER`
(`tests/unit/headless-handler-auth-ledger.test.ts:152`) — the ledger already knew.

### Re-verified by CONTIGUOUS read (the first pass used grep-filtered views)

The three facts above were first taken from grep-FILTERED listings of `routeMessage`, which is
the same proxy-read shape that produced two errors earlier in the same session (an assumed
escaping format; a route-table conclusion from a partial read). Re-read as a contiguous block,
lines 770-812. All three hold, and two get STRONGER:

- **Fact 2 was the load-bearing one and it is confirmed exactly.** The invalid-attestation branch
  is `} else { console.warn('… Invalid role attestation … — ignoring') }` — **no return, no
  throw** — and `auth = { authenticated: true, … }` is assigned BEFORE the attestation block, so
  the subsequent `if (!auth.authenticated) return 401` is already false. The absence of a return
  was INFERRED from a filtered view on the first pass; it is now observed.
- **The code documents the hole itself.** The no-attestation path logs
  `Accepting mesh-forwarded request from ${forwardedFrom} (no attestation)`. This is not a
  subtle omission — it is a deliberate, logged accept.
- **Fact 3 is broader than filed: TWO parameters are accepted and discarded, not one.** Counting
  each parameter's occurrences inside the function body: `authHeader` 2, `forwardedFrom` 14,
  `attestationHeaders` 3, `contentLength` 2 (a real payload-size cap) — but **`signatureHeader`
  1 and `envelopeIdHeader` 1, each being its own declaration.** The caller supplies both
  (`getHeader(req, 'X-AMP-Signature')`, `getHeader(req, 'X-AMP-Envelope-Id')`), so the AMP
  envelope-integrity headers are plumbed end to end and verified nowhere on this path.

> A needle in that same count read `contentLengthHeader` and returned 0, which would have made
> the payload cap look dead too. The parameter is `contentLength`; re-run correctly it is used at
> line 823. Recorded because it is the identical failure class the paragraph above is about, and
> it occurred while measuring it.

> **⚠ AND THE PARAMETER COUNT ITSELF WAS TAKEN OVER THE WRONG WINDOW.** It was computed across
> lines **754-1100**, chosen because it "looked like enough". `routeMessage` actually ends at
> **1352** (`awk 'NR>754 && /^}/{print NR; exit}'`, corroborated by the next top-level export at
> 1358) — so the count covered ~63% of the function and proved nothing about the remaining 252
> lines. **Re-run over 754-1352 the conclusion is unchanged** (`signatureHeader` 1,
> `envelopeIdHeader` 1, both their own declarations; `forwardedFrom` rises 14 → 16, two uses that
> were outside the old window).
>
> **The conclusion was right and the measurement supporting it was invalid — which is luck, not
> evidence.** Worse, it was a REGRESSION dressed as a rigour upgrade: the ORIGINAL check was
> `grep -n 'signatureHeader' services/amp-service.ts` over the WHOLE FILE returning one line, and
> that is the authoritative test for a named positional parameter (it cannot be referenced outside
> its own function, so a whole-file count of 1 settles it). Replacing a whole-file grep with a
> guessed-window count, in a commit whose message boasts about replacing filtered views with
> contiguous ones, is the same failure shape at one more level of self-congratulation.
>
> **BOTH discarded parameters now rest on WHOLE-FILE greps, which is the settling form.**
> `grep -c` over `services/amp-service.ts`: `signatureHeader` **1** (line 759),
> `envelopeIdHeader` **1** (line 758) — each its own declaration. This is authoritative
> independently of where `routeMessage` ends, because a function-local positional parameter
> cannot be referenced from outside the function, and any same-named identifier elsewhere in the
> file could only INFLATE the count. The window question is therefore moot for both.
>
> That grep existed for `signatureHeader` from the first pass and was NOT applied to
> `envelopeIdHeader` when the claim was widened from one parameter to two — so for one commit the
> upgrade was half-evidenced, against this project's own rule that *a correction which widens
> scope needs evidence that widens too*. The claim survives; the gap in its support did not.
>
> **What is still unread, stated precisely rather than alarmingly:** lines 812-1352 have not been
> read contiguously, only through a `return|throw|401|403|verif` filter. That filter is better
> than it first appeared: `routeMessage` returns a `ServiceResult`, so a denial inside it MUST be
> spelled `return { … status: 4xx }` — which the `return` needle matched, all six times
> (`sendServiceResult` lives in the router, not here, so that spelling cannot occur). The gap is
> therefore **six visible returns whose GUARDS were not read**, not a denial that could hide. It
> cannot touch the authentication finding, which is settled contiguously at 770-802 and sits
> BEFORE all six. It could refine EXPLOITABILITY — which this card already declares
> unestablished, so no claim here depends on it.

## Why it surfaced now, and what is NOT claimed

It surfaced while implementing TRDD-8Q5EVGV1's semantic credential gate, which must EXEMPT this
path (it carries no bearer and no cookie, so validating it would break peer routing outright).
Writing that exemption meant justifying it, and the justification — inherited from the comment on
`_headlessHasCredential`'s identical branch — asserted Ed25519 verification that does not happen.

**This is not a regression from that change.** The structural gate exempted the same path in the
same way; the semantic gate preserves the behaviour exactly. The only thing 8Q5EVGV1 changed here
is the COMMENT, corrected in place so it no longer tells the next reader the path is verified.

**Exploitability is NOT established and is deliberately not asserted.** What is measured is the
trust decision. What is unmeasured: whether host ids are practically obtainable by an attacker
(they are distributed by `register-peer` / `exchange-peers`, and are identifiers rather than
secrets, but that is an inference, not a measurement), and whether any deployment exposes
`/api/v1/route` beyond the loopback + IP-filtered-Tailscale surface described in TRDD-8Q5EVGV1's
`## Severity`. Establish both before rating severity.

## Proposed fix

Do NOT start from the code. Start from the QUESTION the design has to answer: what is a mesh peer
allowed to assert about itself without proving it?

Candidate directions, cheapest first — none ruled in:

1. **Require the attestation** rather than treating it as an upgrade: no `senderRoleAttestation`
   verified against `forwardingHost.publicKeyHex` ⇒ not authenticated. Smallest diff; breaks any
   peer that does not send one, so it needs a fleet measurement first.
2. **Verify `X-AMP-Signature`** — the header already exists, is already plumbed to the function,
   and is already discarded. Whatever it was meant to prove, nothing proves it today.
3. **Scope what a `mesh-*` identity may DO.** Note the premise here was CORRECTED before filing:
   an earlier draft said such a caller "becomes a normal authenticated caller", which is wrong.
   Read at 856-862, `isMeshForwarded` is a CLASSIFIER and it RESTRICTS —
   `const senderAgent = isMeshForwarded ? null : getAgent(auth.agentId!)`, so a mesh caller never
   resolves to a registered agent, and the R36/R37 user-authority branch below is gated
   `if (!isMeshForwarded && …)` and skipped entirely. So a forwarded identity is already
   second-class in at least two ways. Whether that is ENOUGH is the open question, and it is a
   narrower one than the earlier draft implied.

> **⚠ THE PARAGRAPH ABOVE WAS WRONG, AND WRONG IN THE DAMAGING DIRECTION. Read this instead.**
> It argued from `senderAgent = isMeshForwarded ? null : getAgent(...)` that a mesh caller is
> "second-class" and therefore that severity is NARROWER. That inferred a variable's MEANING from
> its ASSIGNMENT without reading a single CONSUMER of it — the identical defect it was written to
> correct, one level along, and it landed on the more comfortable answer.
>
> Measured by grepping every use of `senderAgent` and reading both gated sites contiguously,
> `senderAgent === null` is **not a demotion — it is a BYPASS of two checks that constrain a
> normal caller**:
>
> - **`:885` — the unknown-sender rejection is skipped.**
>   `if (!senderAgent && !isMeshForwarded && !senderUserRecord) return 500 'Sender agent not found
>   in registry'`. `isMeshForwarded` is true, so a mesh caller passes a gate that rejects any
>   other unrecognised sender. The comment states the exemption outright: *"A non-mesh sender that
>   is neither a known agent NOR a known user is an error."*
> - **`:1116` — the sender title-graph check is skipped.**
>   `if (senderAgent?.governanceTitle) { … return 403 title_communication_forbidden }` — the R6
>   communication-graph enforcement. With `senderAgent` null the condition is falsy and the whole
>   block does not run, so a mesh caller is not measured against the graph at all.
>
> That is the same phrase TRDD-8Q5EVGV1 used about the forged-token path — *every governance title
> check is bypassed* — reached here by a different route.
>
> **One mitigation, and it is a CLAIM not a measurement:** `:1113`'s comment says this is only a
> pre-check and *"the full graph check happens on the receiving host"*. If true, a second layer
> exists remotely. **Not verified** — citing it as protection would repeat this card's own
> recurring error, so it is recorded as an unverified claim by a comment.
>
> **Net: severity is NOT narrower than this card first implied.** The original framing was closer
> to correct than the "correction" that replaced it. Still UNMEASURED: lines 875-1352 generally,
> and specifically whether the receiving host's graph check exists. That measurement is what the
> next person should do first.

## Verification

A test that presents `X-Forwarded-From: <a registered host id>` with no bearer, no cookie, and no
attestation, and asserts the request is REFUSED. That test fails today — write it first and watch
it fail, or the fix is unpinned by construction.

Then the mirror: a correctly-attested peer still routes, so the fix is not simply a lockout.

## Acceptance

- [ ] a request authenticating solely via `X-Forwarded-From` + a known host id is refused
- [ ] that refusal is demonstrated by a test that FAILED before the fix
- [ ] a correctly-attested mesh peer still routes end-to-end
- [ ] `signatureHeader` is either verified or REMOVED from the signature — a parameter that is
      accepted and never read is a claim the code does not honour
- [ ] `POST /^\/api\/v1\/route$/` is deleted from `UNGUARDED_LEDGER`, which is the ratchet's own
      definition of done
- [ ] the exemption comment in `services/headless-router.ts::_headlessCredentialIsValid` is
      updated to describe whatever the new trust model actually is

## Approval log

- 2026-08-23T11:40:00+0200 — FILED AS A PROPOSAL, awaiting MANAGER. Authored 2026-08-23T11:34:19
  with `min-approval-requirement: manager` and `approved: false`, which was right, but placed in
  `design/tasks/`, which was not: `approved: false` holds only for `column ∈ {proposal,
  superseded}`, and a Tier-2 card in `design/tasks/` is the overlay's named anti-pattern
  ("authoring a Tier-2/Tier-3 task directly in design/tasks/ to skip approval"). Reached by
  accident, not intent — I declined to self-approve and then filed it as though I had. Moved to
  `design/proposals/` with `column: proposal`. Note `trddgrep validate` passed the bad state, so
  that invariant is documented and UNENFORCED — worth its own card.
