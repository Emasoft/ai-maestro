---
trdd-id: WF0UE9BC
title: Ship AgentlensPro as an official ai-maestro dependency (npm CLI, installed alongside the stack)
column: planned
created: 2026-07-16T14:13:15+0200
updated: 2026-07-16T14:22:00+0200
current-owner: ai-maestro
task-type: infra
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T14:13:15+0200
relevant-rules: [32, 23]
labels: [dependency, observability, install, agentlenspro, supply-chain]
external-refs: [Emasoft/ai-maestro#70, Emasoft/AgentlensPro#2, Emasoft/ai-maestro-janitor#78]
implementation-commits: []
---

# Ship AgentlensPro as an official ai-maestro dependency (npm CLI, installed alongside the stack)

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved — USER mandate (2026-07-16):** *"make the AgentlensPro being installed
along with ai-maestro. make it an official dependency. coordinate with the claude that
is currently managing it writing an issue on Emasoft/AgentlensPro."*

**What AgentlensPro is:** an npm CLI `agentlenspro` (~40 diagnostic tools, headless-safe,
SLSA-provenance / OIDC trusted publishing) — machine-scope agent observability (burn
forensics, cost analytics, OTEL ingest). It is **NOT a Claude Code plugin** → the
`{plugin}--v{version}` tag mechanism (TRDD-JT3U4ZVM) does not apply. It is the SAME
dependency tier as the code-analysis tooling (tldr/fastedit/distill, TRDD-ZFHY7UGU):
a CLI on PATH for every agent, installed by ai-maestro's own installer.

**NEXT ACTION:** implement the install wiring (below), then coordinate (issue on
Emasoft/AgentlensPro + answer #70). One step is **owner-gated**: the pin target 2.8.0
is not on npm yet (latest published = 2.6.0) — the owner must publish/tag 2.8.0 (npm
publish = a credential/release action the model cannot do). Installer is fail-soft so
this never bricks the ai-maestro install.

## The 5-point contract (answers to #70; each becomes locked)

1. **Dependency channel — npm CLI, semver floor `>=2.8.0`, installed by ai-maestro's
   installer.** New `scripts/install-agentlens.sh` (fail-soft, idempotent, exits 0),
   called from `install-messaging.sh` right after the code-analysis-tooling block.
   No CC-plugin wrapper — agents invoke the CLI directly (like `tldr`). The consumer
   tier is the SERVER/infra + the janitor (already consuming, janitor#78).
2. **Consumed surface — the 3 janitor-locked tools stay the contract floor:**
   `get_account_status` (`cacheTtl.minutes`), `get_burn_status`
   (`global.costPerHour`, `activeSessions`, `topSessions[].{workspace,sessionId}`),
   `investigate_burn` (`findings[].{cause,shareOfWindow,confidence}`,
   `attribution[].workspace`) — already pinned in their `cliContract.janitor.test.ts`
   (d1a3074). Plus the stable JSON `--out FILE` output and `list`/`help <tool>`
   introspection. Any NEW field ai-maestro consumes is named to them and joins that
   test before we depend on it (their reshape-fails-CI discipline).
3. **State-footprint ruling (#32) — ACCEPTABLE.** `~/.agentlens` (SQLite + configs) is
   **machine-scope observability infrastructure state** (ONE server, all agents), not
   PER-AGENT plugin state. R32/#32 forbids a PLUGIN writing per-agent state outside the
   agent workdir; AgentlensPro is a machine-scope CLI/server, so `~/.agentlens` is in
   the same class as `~/.aimaestro` (the server's own state), `~/.claude`,
   `~/.agent-messaging`. Not a violation.
4. **Ports/env — no collision.** AgentlensPro: UI :3000, MCP :4316, OTLP :4318, all
   env-overridable (`UI_PORT`/`MCP_PORT`/`OTLP_PORT`/`DATA_DIR`). ai-maestro: :23000.
   No reserved-port need from our side beyond avoiding :23000 (already clear). It runs
   as ONE machine-scope server, not per-agent (correct for the shared-UID tmux model).
5. **Version floor — pin `>=2.8.0`; OWNER must publish 2.8.0 to npm first.** 2.8.0
   carries the contract test + calibrated windows + attribution feed. Live npm latest
   is 2.6.0 today, so the pin only resolves on a fresh machine once the owner
   publishes/tags 2.8.0. Until then the fail-soft installer warns and continues.

## Integration direction (USER, 2026-07-16) — the dependency is the FOUNDATION for this

AgentlensPro (owner's project, based on the original Agentlens; repo `Emasoft/AgentlensPro`,
owner keeps a local dev checkout) is a full agent-observability suite: activity, **costs,
token usage, telemetry, logs, conversation .jsonl, account tracking, and OAuth-token
rotation**. CLI = realtime diagnostic reports; server = a dashboard with log views + stats.

The owner's intended end-state (roadmap, NOT this task): incorporate it into ai-maestro
either (a) **as a dedicated tab**, or — preferred — (b) **extract its data to ENRICH the
existing chat-history tab** with **token-accurate tracing, cache usage, and account
tracking** per conversation. This TRDD lands only the DEPENDENCY (install + contract); the
tab/enrichment is a follow-up UI TRDD that consumes the surface below.

**Consumed surface for the enrichment (sharpened from the live `agentlenspro list`):**
- token tracing per session/conversation → `get_agent_tokens`, `get_cost_rollup`
  (5-value: input/output/cache_read/cache_creation/cost), `get_session_detail`
- cache usage → `get_context_growth` (cache-READ vs cache-CREATED split),
  `get_cache_creation_report`, `check_cache_expiry`
- account tracking → `get_account_status`, `get_window_budget`, `get_window_eta`
- conversation view → `get_conversation` (verbatim per-turn from the .jsonl)
- realtime burn (janitor already consumes) → `get_burn_status`, `investigate_burn`,
  `get_heartbeat_cost`

**SECURITY GUARDRAIL (R16 — load-bearing):** AgentlensPro's "account tracking / OAuth-token
rotation" touches CREDENTIALS. ai-maestro may consume account **metadata** (which account,
plan, billing mode, cache-TTL regime, window budget) to enrich the UI, but **OAuth token
material must NEVER reach an agent or the model**, and the rotation capability is
**infrastructure only — never surfaced as an agent-callable verb**. The chat-history
enrichment shows *which account a session ran on and its window budget*, not the token.

## Plan

**A. Implement (this repo, R23-mine):**
- `scripts/install-agentlens.sh` — fail-soft `npm i -g agentlenspro@>=2.8.0` (idempotent:
  skip if already on PATH at ≥ floor; clear warn + continue if the floor isn't on npm yet;
  verify with `agentlenspro --version`). Exits 0 always.
- `install-messaging.sh` — call it after the code-analysis-tooling block, same
  interactive/non-interactive shape.
- `scripts/ecosystem-config.sh` + `lib/ecosystem-constants.ts` — add the package name +
  version floor as the single source of truth (`AGENTLENS_NPM_PKG`, `AGENTLENS_VERSION_FLOOR`).

**B. Coordinate:**
- Answer #70 on this repo with the 5-point contract.
- Open an issue on Emasoft/AgentlensPro (USER's explicit ask) recording the locked
  contract from ai-maestro's side + the one owner-gated action (publish 2.8.0).

## Verification
- `bash -n scripts/install-agentlens.sh install-messaging.sh` (syntax); shellcheck if available.
- Dry idempotency: with 2.8.0 already installed here, re-running the installer skips + exits 0.
- `bash scripts/with-node.sh yarn build` if the TS constant is read by server code.

## Approval log
- 2026-07-16T14:13:15+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
