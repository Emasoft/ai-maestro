---
trdd-id: Y916N7WL
title: Derive continuity status metadata from the AgentlensPro CLI (observe-only source)
column: testing
created: 2026-07-16T20:06:24+0200
updated: 2026-07-16T20:35:34+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-16T20:06:24+0200
relevant-rules: [16, 23]
labels: [family-a, continuity, agentlenspro, status, observe-only, npt]
external-refs: [Emasoft/AgentlensPro#3, Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [fbf28fb0]
---

# Derive continuity status metadata from the AgentlensPro CLI (observe-only source)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

Root of the Family-A topological order (nothing blocks it; dep AgentlensPro#3 landed via
TRDD-WF0UE9BC). It builds the **metadata source** that `DXJZM3BW`'s `status` verb reads.

**✅ IMPLEMENTED 2026-07-16 (commit `fbf28fb0`) — `column: testing`.** `lib/agentlens-status.ts`
reads `agentlenspro get_account_status --full` and maps the CI-locked canonical paths
(`usageWindows.{fiveHourPct,sevenDayPct,windowSource}` + `.cacheTtl.minutes`) to the four
observable `status` fields; verified against the live CLI shape (Max-20x machine). Split into
pure `parseAgentlensStatus` + `deriveAccountHealthy` (12 unit tests, `tests/unit/agentlens-status.test.ts`);
tsc + `next lint` clean. **NEXT: consumed by [[DXJZM3BW]]'s `status` verb** (the 5th field
`next_action` is added there once [[1GGQ4HWY]] exists).

## Problem / Goal

The continuity `status` verb (built in [[DXJZM3BW]]) must report `account_healthy`,
`window_5h_pct`, `window_7d_pct`, `cache_ttl_minutes` — metadata ONLY, never token material.
AgentlensPro is the canonical source for account/window/cache observability and is now an
official ai-maestro dependency (AgentlensPro#3, contract locked). This NPT wires the server to
CONSUME that CLI and map its output to the four metadata fields.

## Scope (build the delta, do not reinvent observability)

- A server-side reader that shells the AgentlensPro CLI (canonical paths pinned on
  AgentlensPro#3) and parses account/window/cache metadata into the four `status` fields.
- A **CI-locked contract test** that fails if AgentlensPro's output shape drifts from the
  locked contract, or if a token-adjacent field is ever surfaced.
- `next_action` (the 5th `status` field) is NOT derived here — it is computed by the OAuth
  manager ([[1GGQ4HWY]]) from the cascade state; this NPT supplies only the four observables.

## Trust boundary (the load-bearing invariant)

AgentlensPro is **OUT of the trust boundary** — verified in `accountInfo.ts` (it emits no
token, has no rotation; it lifts identity/plan/window metadata through a single choke-point
that drops the secret, AgentlensPro#3 / `accountInfo.ts:10-13`). So this NPT only ever READS
metadata; custody + rotation stay [[1GGQ4HWY]]'s infrastructure alone. A contract test guards
that the consumed surface can never carry a credential.

## Verification

- Unit: given a fixture of AgentlensPro CLI output, the reader yields the four fields; a
  malformed/absent field fails fast (no silent default that masks a dead account).
- Contract test red on any AgentlensPro shape drift or any token-adjacent field.
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `yarn test` green.

## Approval log

- 2026-07-16T20:06:24+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], observe-only,
  in-scope dev). Authored directly as `planned`.
