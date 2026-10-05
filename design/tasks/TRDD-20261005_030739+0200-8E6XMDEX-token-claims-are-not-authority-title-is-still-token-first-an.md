---
trdd-id: 8E6XMDEX
title: Token claims are not authority — title is still token-first and issuer team id is stamped from the token
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:16:02+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T03:07:39+0200
relevant: [TRDD-A50RC5G8]
---

# Token claims are not authority — title is still token-first and issuer team id is stamped from the token

## Problem

Split out of TRDD-A50RC5G8 (2026-10-05). A governance token carries claims minted at issue time and valid for 3600 s (lib/aid-token.ts:78, per worker read). The team-id claim no longer grants anything known in lib/authorization.ts or the mint guard (3a78439f6, d7381136e). What is left:

- The caller TITLE is token-first: `const title = auth.governanceTitle || lookupGovernanceTitle(auth.agentId)` (lib/authorization.ts ~390, read by the orchestrator). Every branch, including manage-team, trusts it until expiry. It is safe only if every title change revokes the agent's tokens — per worker read ChangeTitle does (gate G14b) but skips when the title is unchanged, and whether every path that changes a title goes through ChangeTitle was not established.
- app/api/agents/[id]/portfolio/route.ts:164 stamps `issuer_team_id` from the token (per worker read); a stale value mis-scopes a team-wide revocation.
- The reader inventory was a grep; dynamic access forms were not covered.
- Team changes do not revoke tokens (ChangeTeam only indirectly through ChangeTitle; cross-host never). Preferred direction, already taken: do not trust the claim, rather than revoke inside pipelines that roll back.

## Proposed fix

Resolve the title from the registry at decision time (or prove revocation is complete on every title-changing path); stamp issuer_team_id from the registry.

## Acceptance

- [ ] Every path that changes governanceTitle is listed, and each either revokes tokens or the title claim is no longer trusted
- [ ] A test: an agent demoted from MANAGER cannot use a token minted before the demotion for manage-team
- [ ] issuer_team_id comes from the registry
- [ ] Reader inventory repeated with a method that covers dynamic access
- [ ] lib/portfolio-store.ts exports revokeTokensForSubject(agentId) and NOTHING in lib/ services/ app/ calls it (grep by the orchestrator, 2026-10-05): portfolio tokens issued TO an agent are apparently not revoked when that agent is soft-deleted or leaves its team. Verify by reading the verify path (does a token for a non-live subject still verify?) before fixing
- [ ] Scope of the revokeTokensForSubject finding, widened: its only caller is its own unit test — searched lib services app components hooks scripts tests and server.mjs across .ts .tsx .mjs .js .cjs .sh

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
