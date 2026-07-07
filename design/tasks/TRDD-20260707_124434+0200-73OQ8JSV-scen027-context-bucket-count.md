---
trdd-id: 73OQ8JSV
title: Loosen SCEN-027 S011 context-breakdown bucket-count assertion to at-least-7
column: planned
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-73OQ8JSV — Loosen SCEN-027 S011 context-breakdown bucket-count assertion to at-least-7

## Problem

`tests/scenarios/SCEN-027_jsonl-session-browser.scen.md` step S011 asserts
exactly **7 horizontal bars** in the Context Breakdown panel:
`systemPrompt`, `systemTools`, `mcpTools`, `customAgents`, `memory`,
`messages`, `freeSpace` (Goal: "7 horizontal bars are present, one per
category: ..."; Verify: "Snapshot shows all 7 labels rendered").

The running UI (`components/agent-profile/sessions/ContextBreakdownPanel.tsx`)
now renders **9 categories** — the original 7 plus **Skills** (split out
from System tools) and **Autocompact buffer**. SCEN-027's 2026-05-23 run
treated 9-present-and-superset-of-7 as a PASS by runner judgment, but the
scenario's literal wording ("7 horizontal bars") will read as a strict
failure to any future runner or automated checker that takes the step text
literally, and does not allow the context-breakdown API to keep growing
new buckets without triggering an assertion mismatch on every future run.

## Root cause

The context-breakdown API/component grew organically after the original
Phase-3 spec (which covered exactly the 7 original buckets) — Skills and
Autocompact buffer were added later as the feature matured, but the
scenario file's assertion text was never revised to match the current
shape.

## Proposed fix

In `tests/scenarios/SCEN-027_jsonl-session-browser.scen.md`, S011:

1. **Goal** — change to: "**At least 7** horizontal bars are present,
   covering: System prompt, System tools, MCP tools, Custom agents, Memory
   files, Messages, Free space. Skills and Autocompact buffer (or any
   further buckets the context-breakdown API grows) are acceptable
   additional bars and do not fail the step."
2. **Verify** — change the assertion from "all 7 labels rendered" to "≥7
   bars rendered AND all 7 originally-required labels
   (`systemPrompt`/`System prompt`, `systemTools`/`System tools`,
   `mcpTools`/`MCP tools`, `customAgents`/`Custom agents`,
   `memory`/`Memory files`, `messages`/`Messages`,
   `freeSpace`/`Free space`) are present among them." Do not assert
   `=== 7` — the panel is explicitly allowed to grow new categories.

Cross-reference: `components/agent-profile/sessions/ContextBreakdownPanel.tsx`
is the current source of the bucket list; consult it directly if the exact
current label set needs to be re-verified before landing this wording
change (do not hardcode a count in the scenario ever again — assert
presence of the required subset instead).

## Verification

Re-run SCEN-027 after the edit; S011 should PASS against the current
9-bucket UI without needing runner judgment calls, and would continue to
pass if a 10th bucket is added later.

## Estimated risk

LOW — scenario markdown file only, no application code touched.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
