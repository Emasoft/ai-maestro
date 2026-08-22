---
trdd-id: LS1UNUP1
title: Author the credential and authentication spec in design specs
column: todo
created: 2026-08-22T17:36:21+0200
updated: 2026-08-22T17:36:21+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:36:21+0200
---

# Author the credential and authentication spec in design specs

## Problem

`design/specs/` holds 8 specs and NONE covers authentication or credentials, for a system whose
entire governance rests on distinguishing credential classes. Measured 2026-08-22: no file in
`design/specs/` matches `auth|password|credential|token|secur`.

The consequence is not theoretical. With no spec, the contract is re-derived from CODE COMMENTS
each time, and comments are evidence about the line they sit on and nothing more. Two measured
cases from one session:

1. `TRDD-K2WJH7RF`'s acceptance box asserted *"a real `aim_tk_*` token needs a live human session
   token"*. False — `aim_tk_` is ONE prefix minted for BOTH subject classes (`lib/aid-token.ts:375`
   agent, `:426` user); the discriminator is `subject_type`. That false premise stood 20 days and
   caused agent-performable verification to be parked as human-only.
2. `app/api/auth/sudo-password/route.ts` comments say a sudo password may be requested *"ONLY via
   the UI"*. The ENFORCED predicate is `if (!ctx.isSystemOwner)` — it refuses AGENTS, not scripts.
   An owner session mints from a shell (measured, HTTP 200). Prose and predicate disagree.

## Proposed fix

Author `design/specs/credentials-and-auth-spec.md` covering, per class and derived from CODE with
`file:line` citations (comments as corroboration only): the seven credential classes
(governance password, dev-mode login token, sudo token, human session cookie, AID governance
token, server session secret, AMP API key), each one's shape/prefix, store, minter, what it
authorizes, TTL, revocation path, and the gate that enforces it. State explicitly where a comment's
INTENT and the enforced PREDICATE differ, since that gap is what misled callers twice.

## Verification

- Every claim carries a `file:line` and is re-derivable by grep.
- Conformance test asserting each declared prefix constant still equals the spec's value, so a
  rename cannot silently invalidate the spec.
- `memgrep recall` on a credential symptom returns the wiki hub `password-and-credential-system`,
  which links to this spec.

## Estimated risk

LOW to author. The risk of NOT doing it is measured above: two false premises, one of which parked
real work for 20 days.

## Approval log

## Approval log

- 2026-08-22T17:36:21+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
