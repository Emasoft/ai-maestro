---
trdd-id: 8E6XMDEX
title: Token claims are not authority — title is still token-first and issuer team id is stamped from the token
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:25:39+0200
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
- [ ] INVESTIGATION DONE (read-only, by a worker; report under reports/8e6xmdex/, token-claims): a governance token (aim_tk_) carries the title and team stamped at mint for 3600 s and authorize() prefers it over the registry; session secrets, AMP keys and IBCT resolve live. The only eager invalidation is ChangeTitle gate G14b, whose failure is caught and logged as a WARN. Six other readers trust the token title directly
- [ ] FIX ATTEMPTED AND REVERTED (worker stop condition): resolving the title live in authenticateAgent for aim_tk_ callers. Blocker: resolveGovernanceContext loads ./governance, ./agent-registry and ./team-registry with lazy require(), which does not resolve under vitest — it always falls into its catch and returns autonomous — so the fix cannot be tested and 88 tests in tests/authorization.test.ts flip. It also means the EXISTING live-title path for session secrets has no working test. The 5 tests written for the fix are parked at tests_dev/aid-token-title-is-resolved-live.test.ts.parked (gitignored)
- [ ] Soft-deleted agent: its session secret hash stays in the registry row and findAgentBySessionSecret iterates rows including deleted ones, so the secret still authenticates that id with title autonomous (per worker read, not executed). DeleteAgent revokes AMP keys and governance tokens only
- [ ] Portfolio tokens: the verifier never checks the SUBJECT is live or still in the issuer's team; revokeTokensForSubject and revokeMandatesForTeam have no production caller. Blast radius today is small because the list of operations requiring a token is empty (per worker). revokeTokensForSubject has no compensable twin, so a DeleteAgent gate cannot use it as is
- [ ] Make a failed G14b revocation fail the title change instead of logging a WARN (the gate already declares an undo)

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
