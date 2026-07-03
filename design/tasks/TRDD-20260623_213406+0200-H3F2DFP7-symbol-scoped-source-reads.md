---
trdd-id: H3F2DFP7
title: Symbol-scoped source reads — read function bodies, not whole files (L8)
column: dev
created: 2026-06-23T21:34:06+0200
updated: 2026-07-03T21:00:06+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 2
severity: MEDIUM
effort: S
labels: [scenario-tests, tokens, fix-as-you-go, serena, tldr]
task-type: refactor
parent-trdd: TRDD-N1FYP2AW
relevant-rules: []
release-via: none
test-requirements: [integration]
runtime-targets: [macos]
attempts: 0
last-test-result: not-run
implementation-commits: [c4d65da6, dee0b805, 3e86b80e]
---

# TRDD-H3F2DFP7 — Symbol-scoped source reads (L8)

## ⏵ STATE — READ FIRST (authoritative) — 2026-07-03
Impl **DONE** in `.claude/agents/scenario-runner.md` (Phase D step 2 — `tldr search "<name>"
<dir>` → ranged `Read` with `offset`/`limit`, deliberately **NO MCP** to preserve the L2 lean
base; a `NEEDS-FIXER: <file> <symptom>` escape hands genuinely complex fixes to a separate
SERENA-carrying fixer). Landed in `c4d65da6` (L6-L9 origin) → `dee0b805` (gaps #5-#8) →
`3e86b80e` (serena→tldr cleanup). `column: dev` kept (not `complete`): live Phase-2
validation is gated on the USER scenario-run go (~$40 opus[1m], task #59, TRDD-N1FYP2AW Phase 2).

## Problem
During FIX-AS-YOU-GO the runner reads SOURCE files to diagnose a bug. Whole-file
Reads of files like `services/element-management-service.ts` (thousands of lines)
inject huge blobs that then ride forward in context every turn. The agent
usually needs only ONE function body, not the whole file.

## Solution — read only the symbols you need (no full files)
Read just the relevant symbol + its body. Two interfaces give this:
- **SERENA MCP** (`find_symbol`, `get_symbols_overview`, body-only reads) — the
  user's first choice. BUT loading SERENA as an MCP server re-adds ~30K+ of MCP
  tool schemas to the runner's base, **directly conflicting with L2** (the curated
  runner deliberately loads ZERO MCP, which is a big part of the win).
- **`tldr` CLI** (already on PATH; supports TypeScript) — same scoped-read
  benefit with **zero MCP base cost**, via Bash:
  - `tldr structure <file> --lang typescript` → symbol map (names + line ranges)
  - `tldr extract <file>` → per-symbol info
  - `tldr context <symbol> --project <dir>` → just the relevant code + deps
  - `tldr search "<name>" <dir>` → locate a symbol structurally

## Decision — use `tldr` for the runner; keep SERENA for a fix-only path
- **Default (in the curated Sonnet runner): `tldr` via Bash.** Preserves L2
  (no MCP). For a precise read, `tldr search "<name>" <dir>` to get the symbol's
  file:line (or `tldr extract <file>` for a file's symbol/import inventory), then
  `Read` with `offset`/`limit` for exactly that range — scoped, no MCP.
  (`tldr structure` returns EMPTY on this repo's `.ts`/`.tsx` — do not rely on it.)
- **If a fix is genuinely complex** (multi-symbol, cross-file refactor), that is
  better handled by a SEPARATE fixer agent that DOES carry SERENA MCP — the
  runner flags `NEEDS-FIXER: <file> <symptom>` and the orchestrator dispatches
  it. (Mirrors the L4 screenshot-interpreter split; keeps the runner's base lean.)
- **NEVER** `Read` a whole >300-line source file just to see one function.

## Implementation
- A "Scoped source reads (L8)" rule in `scenario-runner.md` Phase D
  (FIX-AS-YOU-GO): use `tldr structure` + ranged `Read`, never whole-file.
- Document the SERENA-vs-L2 tradeoff inline so a future maintainer doesn't
  "helpfully" add SERENA MCP back to the runner and silently blow up its base.

## Risks / Phase-2 validation
- `tldr` TS coverage (VERIFIED 2026-06-23): `tldr structure` returns empty on
  this repo's `.ts`/`.tsx`, but `tldr search "<name>" <dir>` (→ file:line) and
  `tldr extract <file>` (→ per-file symbols + imports) both work. Use those, then
  ranged `Read`. Pure fallback: grep the symbol's line, ranged `Read` (still
  scoped, no MCP).
- The fixer-agent split is deferred (nesting constraint) — for now the runner
  uses tldr + ranged Read; complex fixes are flagged for the orchestrator.

## Approval log
- 2026-06-23T21:34:06+0200 — Authored under /go-on-yourself. Tier 0. Child of
  TRDD-N1FYP2AW. Resolves the SERENA-MCP-vs-L2 tension in favor of `tldr` CLI.
