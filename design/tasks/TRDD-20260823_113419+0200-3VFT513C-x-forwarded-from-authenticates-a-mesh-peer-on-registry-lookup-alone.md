---
trdd-id: 3VFT513C
title: X-Forwarded-From authenticates a mesh peer on registry lookup alone and the signature header is never read
column: todo
created: 2026-08-23T11:34:19+0200
updated: 2026-08-23T11:34:19+0200
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
3. **Scope what a `mesh-*` identity may DO** — it currently becomes a normal authenticated caller.
   Even with (1) or (2), a forwarded identity arguably should not be equivalent to a local one.

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
