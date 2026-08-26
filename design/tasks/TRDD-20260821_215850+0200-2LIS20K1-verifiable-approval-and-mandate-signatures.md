---
trdd-id: 2LIS20K1
title: Make APPROVAL and MANDATE signatures cryptographically verifiable, not convention-only
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-26T05:55:05+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: L
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#47, Emasoft/ai-maestro#46, Emasoft/ai-maestro#27, Emasoft/ai-maestro#33]
---

## Problem

Two governed-action protocols exist by convention: **APPROVAL** (agent proposes, an authority
signs, agent verifies before executing) and **MANDATE** (an authority orders, agent verifies
before executing). Today "verification" means reading a git-tracked `## Approval log` line, or a
self-certified authority claim in AMP message body prose — both are auditable after the fact and
**forgeable by anyone with repo write, or anyone who can type a message**. This already cost a
live incident (2026-08-05): a MANAGER-titled agent sent a legitimate mandate to a freshly created
AUTONOMOUS agent; the recipient had no way to verify the sender's title from the message itself
(delivery was local-filesystem, no server-side title resolution; the authority claim was
self-certified prose), so it refused and blocked on a human to vouch for the sender in person.

## Root cause

No signing/verification layer exists between an agent's claimed governance title and the action
it authorizes. AID resolves identity but nothing binds a signature to it for approval/mandate
tokens specifically.

## Proposed fix

Sequenced per the issue: identity layer (#46, per-agent AID signing) → signing + verify verbs →
protocols become enforceable.

1. Extend the server-issued approval tokens (from #27's `approval-request`/`approval-answer`) to
   also cover **MANDATE** tokens (top-down, MANAGER/COS-issued).
2. Add a `verify` CLI/API surface so a receiving agent can confirm a given approval/mandate
   signature was issued by the claimed authority, for the specific TRDD/action, bound to the
   signer's per-agent AID identity.
3. Enshrine the APPROVAL vs MANDATE protocol + the tier criteria table (Tier 0 self / Tier 1 COS /
   Tier 2 MANAGER / Tier 3 USER) as a governance rule in `GOVERNANCE-RULES.md`, alongside the
   R22/R23 work already landing there.

## Verification

- A forged mandate message (correct-looking prose, wrong/no signature) is rejected by `verify`.
- A genuine MANAGER-issued mandate round-trips through `verify` successfully without a human
  vouching step.
- The tier table's Tier-3 (GOLDEN PRRD) case is provably signable only by USER, never MANAGER.

## Acceptance

- [x] Approval tokens (#27) extended to cover MANDATE, top-down — DELIVERED (found 2026-08-26, not built by this card): `app/api/agents/[id]/portfolio/route.ts:78-79` accepts `kind: approval|mandate`; mandate = unlimited-use with a bounded TTL ceiling (:36-37, :141).
- [x] `verify` surface implemented — DELIVERED: dedicated route `app/api/agents/[id]/portfolio/verify/route.ts` (receiver-readable by design — the verifier is neither subject nor issuer; verification grants nothing) + `aimaestro-portfolio.sh verify` (exits non-zero on an invalid verdict; a 404 is the real answer 'not authentic', distinguished from transport failure — the CLI header documents the contract citing ai-maestro#47 ask 2 and R41).
- [x] APPROVAL vs MANDATE protocol + tier table enshrined — DELIVERED: **R41** (docs/GOVERNANCE-RULES.md:1461, R41.1-R41.6) incl. the fixed authority ladder (R41.4: no agent holds the user rung), no-self-approval (R41.5), USER-only GOLDEN signing (R41.6), and the objective tier-floor table.
- [ ] The 2026-08-05 incident's reproduction case (unverifiable mandate → forced human vouch) no longer occurs
- [ ] Comment posted on Emasoft/ai-maestro#47 confirming the card and status

## Approval log

## ⏵ STATE — 2026-08-26 (hub, premise check on resume; placed after the Approval log for zone honesty — the log itself stays empty)

**3 of 5 boxes were already delivered by other cards** (the delivered-but-unadvanced class):
the portfolio token system covers both kinds, `verify` exists at route + CLI, and R41 is the
enshrined rule. Ticked above with citations; nothing was built under this card (it remains
`min-approval-requirement: manager`, `mandate: false`, no approval record — not executable).
Open: box 4 (a LIVE forged-vs-genuine mandate round-trip reproducing the 2026-08-05 incident
shape — needs two real agents, an operator-scheduled exchange) and the status half of box 5.
Known limit from the lessons file: `verify` answers the PROPOSAL gate; a card closed on a
review verdict is unverifiable by it (TRDD-06G43RK2) — in scope for box 4's design.
