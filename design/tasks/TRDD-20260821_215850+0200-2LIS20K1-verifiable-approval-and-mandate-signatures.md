---
trdd-id: 2LIS20K1
title: Make APPROVAL and MANDATE signatures cryptographically verifiable, not convention-only
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-21T21:58:50+0200
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

- [ ] Approval tokens (#27) extended to cover MANDATE, top-down
- [ ] `verify` surface implemented, bound to AID identity
- [ ] APPROVAL vs MANDATE protocol + tier table enshrined in GOVERNANCE-RULES.md with an R-number
- [ ] The 2026-08-05 incident's reproduction case (unverifiable mandate → forced human vouch) no longer occurs
- [ ] Comment posted on Emasoft/ai-maestro#47 confirming the card and status

## Approval log
