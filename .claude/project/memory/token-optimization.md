---
name: token-optimization
description: "Why a UI scenario run could cost 130M+ tokens and how to keep token usage low: the 8 mandatory token-saving techniques (minimize turns, fix-first load order, scoped symbol reads, errors-only test/lint/log wrappers, clipped region screenshots, dev-browser-only no raw page/CSS/JS reads, never tail logs raw, concise+DRY reports) mapped to the L1-L9 levers and to exactly where each is implemented (scenario-runner agent, leantool.py, scenario-step-batch / scenario-region-capture skills). Also: why the runner must be opus[1m] and how the 6M kill-switch caps every run."
ocd: 2026-06-24
lmd: 2026-06-24
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: tooling-and-testing
---

A single UI scenario run could cost **130M+ cost-weighted tokens** (base context ~445K re-read across ~284 turns at Opus rate) — and an UNCAPPED fleet of them caused a ~13B-token blowup. **Cost ≈ turns × per-turn-context**, because the whole append-only transcript is re-read every turn. Two multipliers: turns (linear) and per-turn-context (everything still in the transcript). The rules below cut BOTH. The machine-wide source-of-truth is the global rule `~/.claude/rules/token-economy-agents-and-scenarios.md` (the L1-L9 levers); this page is the project-local record of the 8 user-mandated techniques, how they map to L1-L9, and **where each is implemented** so a future session can verify them in one place.

## The 8 mandatory techniques → L-lever → where implemented

| # | Technique | Lever | Implemented in |
|---|---|---|---|
| 1 | **Minimize turns** — drive a group of deterministic steps in ONE call instead of ending the turn after each | L6 | `scenario-step-batch` skill (`runSteps(page,[…])`, stops at first failed assertion); scenario-runner Phase C |
| 2 | **Control load order** — read FIXED inputs (rules, scenario file, MEMORY) once upfront so they sit in the cached prefix; keep VOLATILE observations at the tail and DROP after extracting the fact; the more often a thing changes, the later you read it; NEVER re-read a fixed input mid-run | L7 | scenario-runner Phase A |
| 3 | **Minimize tool output / scoped symbol reads** — never read whole source files; locate the symbol (`tldr search`/`tldr extract` → file:line) then ranged `Read` of just that body | L8 | scenario-runner Phase D. **Via `tldr`, NOT SERENA** — SERENA's MCP schemas cost ~80-120K of base context re-read every turn, which defeats the goal (L2). `tldr` + ranged `Read` give the same scoped reads at zero MCP. (USER-approved this substitution 2026-06-24.) |
| 4 | **Errors-only test/lint/typecheck wrappers** — count + one line per error, never the passing/progress/banner noise | L9 | `tests/scenarios/scripts/lean/leantool.py` — `tsc` / `eslint` / `vitest` / `pytest` subcommands; mirrors the tool's exit code; never swallows a failure |
| 5 | **Screenshot discipline** — few shots; capture the element's clip box (+margin), not the page; for the rare global overview shrink the viewport (`setViewportSize`) first, then restore | L4/L5 | `scenario-region-capture` skill (`scopedAria` / `captureRegion` / `captureLandmarks`); scenario-runner "Token discipline" rules 4-5 |
| 6 | **dev-browser only; never read raw page text / CSS / JS via the agent** — verify via scoped a11y snapshot (text) or clipped screenshot (pixels); one `getComputedStyle` value, never the stylesheet | L2/L5 | scenario-runner: zero-MCP tool surface + "Token discipline" rule 5 |
| 7 | **Never read logs raw** — extract only the error/fail/exception lines | L9 | `leantool.py log <file> [--tail N] [--pattern RE]`; scenario-runner Phase D diagnose step (replaces `tail`) |
| 8 | **Concise + DRY reports** — exhaustive yet no filler; define each non-obvious concept ONCE then refer back; no prose that re-narrates the step table; no over-long pasted code | report discipline | scenario-runner Phase G |

L1 (cheap model for bulk execution) is the one lever this runner CANNOT take: the forked agent inherits a >200K base floor (project CLAUDE.md + global rules + the `scenarios-rules` + dev-browser skills), so a 200K-window model fails to launch — it MUST be a 1M model. On a Max plan that is **`opus[1m]`** (Opus auto-upgrades to 1M for free; Sonnet-1M is gated behind `/usage-credits`, which the USER declined). Because Opus is expensive, techniques 1-8 are LOAD-BEARING, not advisory. See `design/tasks/TRDD-*-TBGGUA2V-*.md`.

## The safety net — the kill-switch (no run can repeat the blowup)

`tests/scenarios/state/batch-budget.json` + `tests/scenarios/scripts/lean/batch-budget-guard.sh` (fail-closed): `hard_token_ceiling_per_run: 6000000`, `max_scenarios_per_run: 27`, a `STOP` sentinel file, and `enabled`/`validated` gates that stay closed until a calibration probe measures the real per-scenario cost. The FIRST probe is the exempt calibration run; a batch is sized only after its measured cost is recorded.

## Notes and lessons learned

[^1]: [ocd:2026-06-24 lmd:2026-06-24] The user named SERENA for technique 3 ("the SERENA MCP can be used to read only the symbols"). Implemented with `tldr` instead, and the user approved ("serena is so heavy? i didn't knew. ok, good choice."). Lesson: an MCP server loaded into a high-turn-count agent is a per-turn cost (its tool schemas ride the base context every turn), so the cheapest scoped-read path for a long run is a plain CLI (`tldr`) + ranged `Read`, NOT an MCP — even when the MCP is the obvious tool for the job.
[^2]: [ocd:2026-06-24 lmd:2026-06-24] Earlier the per-scenario Opus cost was framed as carrying a "long-context premium" past 200K. WRONG — 1M context is standard-priced; the real gate is the auto-upgrade POLICY (Opus auto-upgrades to 1M on Max, Sonnet does not). Lesson: verify billing facts against the docs, never infer a "premium" from the price of a feature.
