---
trdd-id: 3VFT513C
title: X-Forwarded-From authenticates a mesh peer on registry lookup alone and the signature header is never read
column: complete
created: 2026-08-23T11:34:19+0200
updated: 2026-09-09T12:37:07+0200
current-owner: governance-rules-session
created-by: ai-maestro-00
task-type: security
min-approval-requirement: manager
approved: true
npt: []
eht: []
project-id: ai-maestro
repo: Emasoft/ai-maestro
relevant-rules: []
external-refs: []
approval-judge:  manager 
approval-datetime: 2026-09-05T10:20:56+0200
assignee: governance-rules-session
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
> **NEITHER of those is yet a severity claim, and an earlier draft of this box wrongly borrowed
> TRDD-8Q5EVGV1's phrase "every governance title check is bypassed" for them. Struck:**
> Both were then SETTLED by adversarial review, from code already read — they are not open
> questions and the assignee should not re-spend effort on them:
>
> - **`:885` is NOT a bypass. It is the feature.** It returns **500 `internal_error`**, not
>   401/403 — a "this state should be impossible" handler, since the caller already passed the
>   401 at `:797` and `getAgent()` still returned null. And `senderAgent` is null for mesh **by
>   construction** (the ternary), so without the `!isMeshForwarded` clause EVERY mesh request
>   would 500. The clause is what makes mesh work. The comment *"A non-mesh sender that is
>   neither a known agent NOR a known user is an error"* states the error's SCOPE; it was
>   misread as an exemption granted to mesh.
> - **`:1116` has no mesh-specific bypass at all.** `if (senderAgent?.governanceTitle)` is falsy
>   for ANY title-less sender, a local one exactly as much as a mesh one. It is additionally an
>   explicit *"Pre-check … for remote delivery"*, fires only on the degenerate
>   `senderAllowed.length === 0` case (the comment names subagents with no title), and a mesh
>   caller has no title to check BECAUSE it has no local registry entry. Inapplicable, not evaded.
>
> ### SEVERITY IS UNDETERMINED, and this card stops trying to determine it
>
> Three positions have been asserted here across three commits — "becomes a normal authenticated
> caller", then "restricted and second-class", then "a bypass" — each stated with confidence and
> each corrected by the next. **All three were wrong**, including the third's claim that the
> first was "closer to right": `senderAgent = null` genuinely does differentiate a mesh caller, so
> "becomes a normal authenticated caller" was false too. The oscillation is the finding: every
> position was reached by reading a different fragment and generalising, which is one defect three
> times, not convergence.
>
> **What IS established, all by contiguous reads or whole-file greps:**
> - authentication is granted on `X-Forwarded-From` naming a resolvable host id, with no
>   signature check (`:770-796`)
> - `signatureHeader` and `envelopeIdHeader` are declaration-only across the whole file
> - `senderAgent` is `null` for a mesh caller (a ternary, not an inference)
> - two `senderAgent`-gated branches (`:885`, `:1116`) therefore do not run for mesh
>
> **What is NOT established, and is the actual work:** whether those skips help or harm a mesh
> caller; whether the receiving host's graph check exists (claimed only by the `:1113` comment);
> what the remaining `senderAgent` consumers (`:892`, `:915-917`, `:1223-1226`, `:1307`, `:1323`)
> do with null; and lines 875-1352 generally.
>
> **The command that would actually settle severity — for the assignee, not the proposer:**
> `grep -n 'isMeshForwarded' services/amp-service.ts`, which ENUMERATES every site where mesh
> status changes behaviour. Every wrong position above came from reading ONE site and inferring
> the class; enumerating the class first is the fix.
>
> A proposal's job is to carry an open question to an approver, not to close it. The
> authentication fact is enough for a human to decide whether to look. **Severity is for whoever
> takes the card.**
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

- [x] a request authenticating solely via `X-Forwarded-From` + a known host id is refused
- [x] that refusal is demonstrated by a test that FAILED before the fix
- [x] a correctly-attested mesh peer still routes end-to-end
- [x] `signatureHeader` is either verified or REMOVED from the signature — a parameter that is
      accepted and never read is a claim the code does not honour
- [x] `POST /^\/api\/v1\/route$/` is deleted from `UNGUARDED_LEDGER`, which is the ratchet's own
      definition of done
- [x] the exemption comment in `services/headless-router.ts::_headlessCredentialIsValid` is
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
- 2026-09-05T10:20:56+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  mesh-forward auth via unsigned header still present (services/amp-service.ts:770-793) . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
- 2026-09-06T03:17:37+0200 — Fixed the authentication gap: routeMessage (services/amp-service.ts:770-800) now requires a verified Ed25519 role attestation (verifyRoleAttestation against forwardingHost.publicKeyHex) before authenticating a mesh-forwarded caller; missing/invalid attestation or no publicKeyHex on file leaves auth unauthenticated and the existing 401 unauthorized fires (no new status/shape). Both call sites (app/api/v1/route/route.ts and headless-router.ts POST /^\/api\/v1\/route$/) share this one routeMessage, so the fix covers both server modes. Updated the now-stale exemption comments in services/headless-router.ts (_headlessHasCredential and _headlessCredentialIsValid) to describe the new trust model. Updated 2 pre-existing assertions in tests/unit/amp-receiving-host-r6.test.ts that pinned the OLD vulnerable behaviour (unattested/forged-attestation mesh forwards reaching the R6 graph with a null title) to assert the correct, stronger 401-at-authentication refusal instead. Added tests/unit/amp-forwarded-from-peer-auth.test.ts: 7 tests green (3 negative — no attestation, forged signature, no publicKeyHex on file; 2 positive controls — attested peer routes via routeMessage directly and via the real createHeadlessRouter().handle()). Full regression: 6 files / 167 tests green (amp-forwarded-from-peer-auth, amp-receiving-host-r6, r6-communication-graph, amp-service-federation, headless-handler-auth-ledger, headless-router-auth-mirror). tsc --noEmit rc=0. NEUTER RUN: reintroduced the old unconditional 'auth = {authenticated:true,...}' before the attestation check — reddened exactly the 6 refusal-shaped tests by name (2 in the r6 file, 4 in the new file), left the 2 positive controls and the unknown-host case green; reverted, diff-clean, suite re-confirmed 167/167 green. Acceptance boxes 4 (signatureHeader verified-or-removed) and 5 (UNGUARDED_LEDGER entry deleted) NOT ticked — both require edits outside this task's write scope (app/api/v1/route/route.ts for box 4; tests/unit/headless-handler-auth-ledger.test.ts's AUTH_NEEDLES/UNGUARDED_LEDGER for box 5). Uncommitted — coordinator commits.
- 2026-09-06T03:31:29+0200 — (1) OPERATIONAL: registered hosts without publicKeyHex are refused at 401 once 2b7b2d64 is DEPLOYED (nothing is deployed yet — pm2 restart replays the existing build; the latent refusal is a fact about the next deploy); on this machine the hosts file holds 1 registered host, cloud-server-1, and it has no publicKeyHex, is enabled: false, and the server log holds 0 mesh-forward lines — its forwards WOULD be refused after that deploy until its key is registered (coordinator-measured 03:22). (2) DESIGN CHOICE, vetoable: the Ed25519 role attestation is the mesh credential; the X-AMP-Signature path was not implemented and the never-read signatureHeader parameter was REMOVED (services/amp-service.ts, app/api/v1/route/route.ts, services/headless-router.ts + their test callers) rather than wired up, since attestation already supplies the cryptographic proof. (3) Box 5 (UNGUARDED_LEDGER deletion) NOT ticked: read tests/unit/headless-handler-auth-ledger.test.ts — the scanner (enumerateHandlers) reads ONLY the POST /^\/api\/v1\/route$/ handler body inside services/headless-router.ts's route table (lines 1970-1985), which just calls routeMessage(...) and contains none of AUTH_NEEDLES (authenticateAgent(, delegateNextRoute, enforceAuth(, enforceSystemOwner(, authorize(, checkTeamAccess() — the new attestation check lives inside amp-service.ts and is invisible to this textual scan. Deleting the ledger entry would make the stale-entries assertion see it as newly-unguarded ('added') and redden the ratchet; the entry correctly stays. (4) Step-4 test requirement (attested mesh peer with a forbidden title pair refused 403 by the R6 graph, deliver not called) was ALREADY pinned pre-existing by tests/unit/amp-receiving-host-r6.test.ts's 'MEMBER -> MEMBER across the mesh is REFUSED, and nothing is delivered' test (uses attested() + refusedByTheGraph); no duplicate test added. NEUTER: gated the :1299 graph-check with 'if (false && ...)' -> reddened exactly that 1 test by name (MEMBER -> MEMBER), left the other 3 in that file green; reverted, diff-clean, re-confirmed 4/4 green. Full regression 6 files / 167 tests green (headless-handler-auth-ledger, amp-forwarded-from-peer-auth, amp-receiving-host-r6, headless-router-auth-mirror, r6-communication-graph, amp-service-federation). tsc --noEmit rc=0. Column stays dev; uncommitted — coordinator commits.
- 2026-09-06T03:48:06+0200 — CORRECTION to the 03:31:29 line above: it originally read 'refused at 401 from commit 2b7b2d64 on'; nothing is deployed (pm2 restart replays the existing build, no rebuild has run since 2b7b2d64), so the line now reads 'once 2b7b2d64 is DEPLOYED' and qualifies cloud-server-1 with what was measured at 03:22 — the only registered host, no publicKeyHex, enabled false, 0 mesh-forward lines in the server log. The edit itself did not bump updated; this line does.
- 2026-09-09T12:28:10+0200 — takeover by governance-rules-session: assignee ai-maestro-hub-session not alive in ListAgents at 2026-09-09 12:26.
- 2026-09-09T12:29:46+0200 — box 5 done: 'routeMessage(' added to AUTH_NEEDLES (auth lives in the AMP service, shared by the Next route and the headless handler), ledger line deleted, suite 4/4, neuter reds exactly 'no handler is added without auth'. NEXT: deploy (yarn build + restart is USER-HELD) and the USER's cloud-server-1 key decision; this card has no STATE block — no trddgrep verb inserts a section.
- 2026-09-09T12:37:06+0200 — post-write review (fork, 0 tools) of b0b976e7 applied: the 'routeMessage(' needle is a business call, not a refusal primitive, so a fifth test now pins that routeMessage in services/amp-service.ts (754-1357) still calls authenticateRequest( and verifyRoleAttestation( — suite 5/5, neuter (needle → bogus) reds exactly that test; complementary neuter (ledger line re-added) reds exactly 'the ledger carries no stale entries', so the deletion is pinned too (reports/lean-worker/20260909_123548+0200-3VFT513C-complementary-neuter.md). Comment no longer cites delegateNextRoute as precedent. All 6 boxes ticked, release-via absent (terminal = complete): hopping dev→testing→ai_review→complete on the per-part suites (amp-forwarded-from-peer-auth 2026-09-06, ledger 5/5 today); the full suite was not re-run. No STATE block: the card closes on this edit and no trddgrep verb inserts a section. What stays open is NOT this card's: deploying 2b7b2d64 (yarn build + restart, USER HOLD) and the USER's cloud-server-1 key decision, both recorded in the 2026-09-06 lines above.
- 2026-09-09T12:37:07+0200 — COMPLETE by emanuelesabetta. archived → complete.
