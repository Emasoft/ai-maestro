---
trdd-id: 63K2WJ26
title: Batch dev-browser steps per turn — a stop-on-failure driver (L6)
column: dev
created: 2026-06-23T21:34:06+0200
updated: 2026-07-03T21:00:06+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 2
severity: HIGH
effort: M
labels: [scenario-tests, tokens, turns, dev-browser]
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

# TRDD-63K2WJ26 — Batch dev-browser steps per turn (L6)

## ⏵ STATE — READ FIRST (authoritative) — 2026-07-03
Impl **DONE** in `.claude/agents/scenario-runner.md` (Phase C — the `scenario-step-batch`
skill + a `runSteps()` stop-on-failure driver in a single dev-browser call; the skill dir
`.claude/skills/scenario-step-batch/` exists on disk with SKILL.md + references/). Landed in
`c4d65da6` (L6-L9 origin) → `dee0b805` (gaps #5-#8) → `3e86b80e` (serena→tldr cleanup).
`column: dev` kept (not `complete`): live Phase-2 validation is gated on the USER
scenario-run go (~$40 opus[1m], task #59, TRDD-N1FYP2AW Phase 2).

## Problem
Cost = `turns × per-turn-context`. **Turns** is a first-class multiplier, and the
scenario runner inflates it: each dev-browser call is one Bash tool-call = one
**turn**, and a single scenario step is typically snapshot→act→screenshot→verify
= 3–4 turns. A 40-step scenario → 120–360 turns, each re-reading the full
accumulated context. Measured: scenario runs were 214–367 turns (TRDD-N1FYP2AW
§1). Halving the turns ≈ halves the cost (linear lever).

## Solution — a declarative step driver that runs MANY steps in ONE sandbox call
dev-browser executes a JS script piped via heredoc; that script can do an entire
sequence of page actions in a **single Bash call = single turn**. Implement a
driver that takes a declarative step list and executes it sequentially **inside
one turn**, returning a concise per-step pass/fail log — **stopping at the first
failed assertion** so nothing runs blind past a break.

```
runSteps(page, [
  { do:'click',  target:{role:'button',name:'New Agent'}, expect:{role:'dialog'} },
  { do:'fill',   target:{selector:'#name'}, value:'scen018-x', expect:{value:'scen018-x'} },
  { do:'click',  target:{role:'button',name:'Create'}, expect:{text:'created'} },
  ...
]) -> [{i:0,ok:true}, {i:1,ok:true}, {i:2,ok:false, detail:'expected text "created" not found'}]
       // stops at i=2; the agent diagnoses from the concise detail, not a re-run of 0-1
```

One turn covers as many deterministic steps as run clean. The turn only ends when
(a) a step fails (→ FIX-AS-YOU-GO), or (b) a genuine decision/branch is needed.

## Safety — FIX-AS-YOU-GO is preserved
- The driver returns the index + concise reason of the FIRST failure and halts.
- Each step's `expect` is the per-step assertion (replaces the separate verify
  turn). On failure the agent has exactly where + why, and diagnoses normally.
- Steps that need human-ish judgement (read a value, branch on UI state) are NOT
  batched — the agent breaks the turn there deliberately.
- Per-step screenshots (Rule 10) are captured INSIDE the driver via the L5
  `captureRegion` helper (clipped), saved to disk, NOT returned in the result.

## Implementation
- New skill `scenario-step-batch` (SKILL.md lean + `references/step-driver.js`).
- Driver uses only portable Playwright primitives + the L5 resolver (`boxOf`).
- The runner's Phase C is updated: batch the deterministic action runs; break the
  turn only on failure or decision.
- Returns a compact log (`[{i,ok,detail?}]`), never raw snapshots.

## Risks / Phase-2 validation
- Must integrate with the real dev-browser API (waits, sudo modals, navigation).
  The driver supports `do:'wait'`, `do:'sudo'` (password modal), `do:'goto'`.
- Over-batching hides where time goes; keep batches to a logical step group
  (e.g. one wizard page), not the whole scenario.
- Validate on one self-contained scenario; compare turns vs the §1 baseline
  (target: ≥40% fewer turns).

## Approval log
- 2026-06-23T21:34:06+0200 — Authored under /go-on-yourself (user directly
  ordered all four optimizations). Tier 0 (in-scope test infra). Child of
  TRDD-N1FYP2AW. Implementation this session; live validation gated on user go.
