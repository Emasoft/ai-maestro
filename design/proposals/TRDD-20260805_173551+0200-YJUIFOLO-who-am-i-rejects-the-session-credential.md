---
trdd-id: YJUIFOLO
title: The who-am-I endpoint rejects the credential the server hands the session
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: security
min-approval-requirement: user
mandate: false
approved: false
severity: high
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [identity, auth, amp, safety]
external-refs: [Emasoft/ai-maestro#46, Emasoft/ai-maestro#77, Emasoft/ai-maestro#80]
---

# The who-am-I endpoint rejects the credential the server hands the session

## Problem

`GET /api/v1/agents/me` is the canonical self-identity surface. It authenticates via
`lib/amp-auth.ts::authenticateRequest` → `extractApiKeyFromHeader` → `validateApiKey`, and
`isValidApiKeyFormat` requires an exact prefix:

```ts
const KEY_PREFIX_LIVE = 'amp_live_sk_'
const KEY_PREFIX_TEST = 'amp_test_sk_'
```

There are **three** token families in the tree:

| family | minted by | for |
|---|---|---|
| `mst_` | `lib/session-secret.ts` | the per-session secret handed to the pane as `AID_AUTH` |
| `aim_tk_` | `lib/aid-token.ts` | AID governance tokens (`/api/agents/*`, `/api/teams/*`) |
| `amp_live_sk_` | `lib/amp-auth.ts` | AMP API keys |

That route accepts only the third. **The credential the server itself mints and hands to the pane is
not one the who-am-I endpoint will accept** — an agent presenting it gets `unauthorized: Invalid or
expired API key`.

## Root cause — and a correction to #46's premise

#46 is filed as *"sessions cannot self-resolve identity, ~35 agents share one host identity"*. That
premise is **stale**: `lib/session-env.ts` injects `AIM_AGENT_ID` and `AID_AUTH` into every session,
the server minting the secret and storing only the hash, and the no-id path is fail-closed (it
refuses to mint an orphan credential and warns that API calls will 401). Identity exists. What fails
is the *lookup*.

## Why it is a SAFETY item, not a convenience one

This is the root of the `--id <uuid>` finding on #77/#80. With identity unresolvable through the
supported path, `amp-helper.sh`'s advice to an unidentified session — supply someone else's uuid —
stops looking like a bug and starts looking like the documented workflow. Fixing the authenticator
removes the pressure that makes that advice seem reasonable.

## Proposed fix

Have that route authenticate through the **broad** authenticator (`lib/agent-auth.ts`), which
already recognises all three families, instead of the AMP-only one. One import and one call; the
business logic already lives in `services/amp-service.ts`.

**Scope it to `GET`.** `PATCH` and `DELETE` on the same route would otherwise inherit the widening,
and `DELETE /api/v1/agents/me` calls `DeleteAgent` — widening the credential surface of a
self-deletion is a different decision entirely and is not proposed here.

Pattern to copy: `/portfolio/verify` (ai-maestro#47) deliberately accepts *any* authenticated caller
and documents why — the agent that most needs to verify a mandate is the **receiver**, who is
neither subject nor issuer.

## Verification

An agent session holding only `AID_AUTH` must receive its own `agentId` from `GET
/api/v1/agents/me`. Complementary neuter: revert to the AMP-only authenticator and that test must
401 again. Separately assert that `DELETE` on the same route still refuses the widened family —
that is the assertion that proves the scoping held.

## Estimated risk

MED — it widens an authentication surface. Small in code, deliberate in consequence, which is why it
is a proposal and not a task. Dependencies: none; it is independent of #46's other halves.

## Approval log
