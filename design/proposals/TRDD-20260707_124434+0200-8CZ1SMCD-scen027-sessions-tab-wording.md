---
trdd-id: 8CZ1SMCD
title: Fix SCEN-027 wording — Sessions tab is a peer top tab, not inside Profile
column: proposal
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T12:44:38+0200
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

# TRDD-8CZ1SMCD — Fix SCEN-027 wording — Sessions tab is a peer top tab, not inside Profile

## Problem

`tests/scenarios/SCEN-027_jsonl-session-browser.scen.md` describes the
Sessions tab as living inside the Agent Profile panel. Concretely (verified
at HEAD 2026-07-07):

- Frontmatter `ui_sections` (lines 42-45) lists `Agent Profile -> Sessions
  tab -> Session list`, `... -> Chat transcript (virtualized)`, `... ->
  Context breakdown panel`, `... -> Search bar`.
- S007 Action: `"With the agent selected in the sidebar, click 'Profile'
  (or the avatar) to expose the Agent Profile panel."` and its Goal says
  `"Agent Profile panel is visible with tab bar (Overview / Config /
  Plugins / Sessions / Advanced / …)"`.
- S008 Action: `"Click the 'Sessions' tab in the Agent Profile tab bar."`

This does not match the shipped UI: Sessions is a **peer top-level tab**
next to Terminal/Chat/Messages/WorkTree/Search/Export/Profile/Pop-Out, and
the Agent Profile panel itself only has 3 sub-tabs.

## Root cause

Confirmed by reading the current source:

- `components/AgentProfilePanel.tsx:100` — `type TopTab = 'overview' |
  'config' | 'advanced'` (only 3 values; no `'sessions'`).
- `components/AgentProfilePanel.tsx:42-44` — explicit comment: `"Sessions
  (JSONL transcript browser) was previously a sub-tab here; it is now a
  top-level peer of Terminal/Chat/Messages in app/page.tsx, so the dynamic
  import lives there and not in this Profile panel."`
- `components/AgentProfilePanel.tsx:471` — the actual rendered tab list is
  `[['overview', 'Overview'], ['config', 'Config'], ['advanced',
  'Advanced']]`.

This is an authoring artifact: the scenario was written against an earlier
design where the chat-history-browser was envisioned as a Profile sub-tab;
the final Phase-3 placement moved it to the top-level tab bar, but the
scenario file was never updated to match.

## Proposed fix

In `tests/scenarios/SCEN-027_jsonl-session-browser.scen.md`:

1. **`ui_sections`** (lines 42-45) — change every `Agent Profile -> Sessions
   tab -> ...` line to `Agent View -> Sessions tab -> ...` (matching the
   `Terminal tab` / `Chat tab` style other scenarios use for top-level
   tabs).
2. **S007 Action** — change from "click 'Profile' (or the avatar) to
   expose the Agent Profile panel" to something like: "Ensure the agent is
   selected in the sidebar. You do NOT need to open Profile — Sessions is
   a peer top-level tab, not a Profile sub-tab." Its Goal should drop the
   claim that Sessions appears in the Profile tab bar and instead assert
   the agent-view top tab bar is visible (Terminal / Chat / Sessions /
   Messages / WorkTree / Search / Export / Profile / Pop Out).
3. **S008 Action** — change "Click the 'Sessions' tab in the Agent Profile
   tab bar" to "Click the 'Sessions' tab in the agent-view top tab bar
   (next to Terminal / Chat)."
4. **S008 Verify** — add a DOM-position clarification: the "Sessions"
   button should be found in the top tab bar (roughly `y < 100` in the
   snapshot / bounding box), not inside the Profile panel's sub-tab
   region, to disambiguate if both a "Sessions" label ever appears in two
   places again in the future.

Cross-reference for whoever implements this: `components/AgentProfilePanel.tsx:42-44,100,471`
for the Profile-side confirmation that Sessions is NOT there; the
top-level tab bar wiring lives in `app/page.tsx` (see the "Single-Active-
Agent Rendering" section of the project's root `CLAUDE.md` for how the
tab bar and `activeTab` state are structured).

## Verification

Re-run SCEN-027 after the edit; S007/S008 should execute without needing
runner interpretation/correction, and the step wording should match the
UI exactly on first read.

## Estimated risk

LOW — scenario markdown file only, no application code touched.

## Approval log
