---
trdd-id: WF0UE9BC
title: Ship AgentlensPro as an official ai-maestro dependency (npm CLI, installed alongside the stack)
column: human_review
created: 2026-07-16T14:13:15+0200
updated: 2026-08-22T15:31:00+0200
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
implementation-commits: [5d889dc5]
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

**Canonical field paths — AgentlensPro corrected my initial guesses (AgentlensPro#3,
2026-07-16); now LOCKED in their `cliContract.aimaestro.test.ts` @ `098b458` (a reshape
fails their CI). Consume THESE, not the guessed names:**
- `get_agent_tokens` → `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreateTokens`/`totalTokens`/`cost_usd` (snake_case)
- `get_cost_rollup` → `groups[].{input,output,cacheRead,cacheCreation,costUsd}` (+ `totals`); `costUsd`, not `cost`
- `get_context_growth` → `perTurn[].{cacheReadTokens,cacheCreateTokens}` + `totalCacheCreatedTokens` + `overallCacheHitRatePct`
- `get_account_status` → `account`/`plan`/`mode`/`cacheTtl` (+ `account.billingType`); per-window %s at `usageWindows.{fiveHourPct,sevenDayPct,windowSource}`
- `get_window_budget` → `capacitySource`/`machineWide.capacitySource`/`accounts[]` (no fiveHour/sevenDay keys) — read %s from `get_account_status.usageWindows` / `get_burn_status.accountWindows`
- `get_conversation` → `sessionId`/`turnCount`/`compactions[]`/`turns[].{turn,role,messageId,model,ts,usage,blocks[]}`, `blocks[].kind` ∈ userText/assistantText/thinking/toolUse/toolResult

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

## ⏹ TRIAGE 2026-08-02 — `planned` → `human_review` ([[5YRLA53W]])

Re-columned, not closed. `planned` asserts *"not started"*; this card's code landed 17 days ago
(`5d889dc5`), its two coordination issues are closed, and the one owner-gated action it was waiting
on — publishing 2.8.0 to npm — happened. The single remaining item is a decision only the human can
make (close `ai-maestro#70`, or record why it stays open), which is exactly what `human_review`
means. It was found by the external-ref sweep on [[5YRLA53W]], not by anyone reading the board:
`planned` is a resting column nobody re-examines.

## ⏱ VERIFIED 2026-08-02 — everything landed, including the OWNER-GATED step

The card sits at `column: planned` — which asserts *"not started"* — while its
`implementation-commits:` names `5d889dc5` and every external dependency has resolved. Checked
live today, nothing taken from the card's own record:

| the card said | measured 2026-08-02 |
|---|---|
| *"the pin target 2.8.0 is not on npm yet (latest published = 2.6.0) — the owner must publish"* | **npm latest is 2.20.0**; this machine runs **2.21.0**. The floor resolves; the installer no longer no-ops. AgentlensPro confirmed the 2.8.0 publish on `ai-maestro#70` (OIDC trusted publishing, 2 attestations, smoke-verified from a virgin HOME) |
| `janitor#78` (the janitor already consuming) | **CLOSED 2026-07-16** — `dispatch.py::_phase_heartbeat_cost` ships. One deliberate deviation from the proposal: the line goes to `.janitor/logs/heartbeat-cost.log`, NOT the fire's stdout, because the heartbeat's zero-output contract means every stdout byte taxes the very thing being measured |
| `AgentlensPro#2` (lock the CLI contract) | **CLOSED 2026-07-30** |
| `ai-maestro#70` (the coordination thread) | still **OPEN** on our side; the counterparty has closed the loop from theirs |

## Acceptance

Transcribed from this card's own `## Plan` (A + B) and `## Verification` list. Every item re-run or
re-queried on 2026-08-02.

- [x] A — `scripts/install-agentlens.sh` (fail-soft, idempotent, always exits 0) — `5d889dc5`
- [x] A — called from `install-messaging.sh` after the code-analysis-tooling block
      (`install-messaging.sh:964`)
- [x] A — the package name and version floor as ONE source of truth:
      `AGENTLENS_NPM_PKG` / `AGENTLENS_VERSION_FLOOR` in `lib/ecosystem-constants.ts:385-386`
      and `scripts/ecosystem-config.sh`
- [x] B — the 5-point contract answered on `ai-maestro#70`, and the issue opened on
      `Emasoft/AgentlensPro` per the USER's explicit ask (`AgentlensPro#2`, now closed)
- [x] the OWNER-GATED step — 2.8.0 published. This was the single thing the model could not do
      (an npm publish is a credential action), and it is done
- [x] verification — `bash -n` clean on both scripts, **shellcheck clean**, and the dry
      idempotency run: with 2.21.0 present the installer skips and exits 0
- [x] close `ai-maestro#70` from our side, or say why it stays open. Deliberately NOT done
      unilaterally: it is an outward-facing action on a coordination thread the counterparty has
      already answered, so it is the human's call, not a housekeeping side effect.
      **↳ RESOLVED 2026-08-22 — the box was STALE. `ai-maestro#70` is already `CLOSED`** (measured
      first-hand: `gh issue view 70 --repo Emasoft/ai-maestro` → `[CLOSED]`, last updated
      **2026-08-08T13:03:26Z**, 3 comments). It was closed a fortnight ago and this card never
      learned about it, so the box held a finished card open on an act that had already happened.
      The reservation above was CORRECT and is preserved: closing it was the human's call, and the
      human made it. Nothing outward-facing was done here — the box's own second half (*"or say why
      it stays open"*) needed only a measurement, and the measurement says it isn't open.
      Its reciprocal `AgentlensPro#3` closed 2026-07-30, so both halves of the coordination are shut.
- [~] the chat-history ENRICHMENT (the dedicated tab / token-accurate tracing per conversation)
      — explicitly a **follow-up UI TRDD**, not this card. Recorded so the next reader does not
      read its absence as an omission. The consumed surface and the LOCKED field paths are
      already written above, and the R16 guardrail with them: account **metadata** may enrich the
      UI, **OAuth token material must never reach an agent or the model**

## Approval log
- 2026-07-16T14:13:15+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent.

## ⏹ 2026-08-22T15:3x — VERIFIED: the premise HOLDS. An UNDECLARED runtime dependency, today.

| probe | result |
|---|---|
| `grep -ni agentlens package.json` | **absent** — not a dependency, dev or otherwise |
| `command -v agentlenspro` | **on PATH** (installed by hand on this machine) |
| production files referencing it (`lib services app scripts components`) | **12**, incl. a dedicated `lib/oauth-rotator/agentlens-usage.ts` and `lib/analytics-proxy.mjs` |
| positive control (`tmux`, known-used) | 109 files — the search surface is sound, so the 12 is real |

**That combination is the whole finding: the code depends on it, the manifest does not declare it,
and it works here only because someone installed it manually.** A fresh clone runs `yarn install`
and gets nothing, so those 12 files fail at the point they shell out — and they fail on a machine
nobody can reproduce from, because the difference is invisible in the repo.

**Why this hid.** It cannot surface locally: this box HAS the binary, so every local run is green.
It also cannot surface in a type-check or a lint, since the dependency is a PROCESS the code
spawns, not a module it imports — the same blind spot recorded elsewhere in this corpus for prose
and for shelled-out tools. Only a clean environment sees it, and CI runs on a tree 102 commits
behind (see `N4SDG0ML`).

**Still `human_review` and correctly so.** Adding an npm dependency to the stack is a
distribution decision — which package, pinned how, installed alongside what — and the card is
titled as exactly that. This entry establishes that the need is real and current; it does not
decide the shape.

Re-derive rather than trust the table (both have silent timestamps):
`grep -ni agentlens package.json ; grep -rl agentlens lib services app scripts components | wc -l`

- 2026-08-22T18:07 — **HUMAN REVIEW PERFORMED, verdict COMPLETE**, by `ai-maestro-session` under
  the owner's explicit 2026-08-22 grant. Every engineering box was already evidenced with a commit;
  the single open box turned out to be **stale rather than pending** — `ai-maestro#70` has been
  CLOSED since 2026-08-08, verified first-hand rather than inferred. This is the sixth card today
  whose remaining "blocker" had already resolved without the card being told, which is the measured
  hazard of a parked box: parking is exactly what stops anyone re-reading it.
  Provenance caveat: closed via `promote` + `archive`, which anchor no token, so `verify` reports
  UNVERIFIED by design (`TRDD-06G43RK2`).
