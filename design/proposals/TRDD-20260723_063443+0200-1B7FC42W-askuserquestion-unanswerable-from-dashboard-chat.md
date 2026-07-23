---
trdd-id: 1B7FC42W
title: A MANAGER's AskUserQuestion TUI menu is unanswerable from the dashboard Chat — the user↔agent question channel is broken for menu prompts
column: proposal
created: 2026-07-23T06:34:43+0200
updated: 2026-07-23T06:34:43+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
approval-tier: 2
priority: 1
severity: high
effort: M
labels: [scenario-improvement, scen-031, agent-messaging, ui]
relevant-rules: []
external-refs:
  - reports/scenarios-runner/SCEN-031_20260723T033213Z.report.md
---

# AskUserQuestion TUI menu is unanswerable from the dashboard Chat

## Problem
In SCEN-031, after receiving the build directive the MANAGER (persona loaded) asked the user
genuine scoping questions via Claude Code's blocking **AskUserQuestion** TUI menu — e.g.
"Repo visibility for Emasoft/zipsearcher? (1. Public (Recommended) / … / 4. Chat about this)"
and "What does 'ship a v1.0.0 release' mean here? (GitHub Release only / Also publish to PyPI)".

The user's ONLY sanctioned surface to answer an agent is the dashboard **Chat** section
(Rule 0.b: the terminal is read-only to the user). The runner typed the answer ("Public") into
the Chat and sent it. It did NOT reach the TUI: the pane later showed
`⏺ No response after 300s — continued without an answer`. The MANAGER's question **timed out**
and it proceeded on defaults. The user's actual answer was never incorporated.

This makes the user↔agent question channel effectively broken for the common case where an
agent asks via an interactive menu: the human cannot answer through the intended UI, and the
agent silently defaults after a 5-minute stall. (Observed identically in the prior SCEN-031
run, MEMORY BUG-003 — this run confirms it recurs even with the persona correctly loaded.)

## Root cause
The dashboard Chat sends a message that does not map onto the keyboard-navigation an
AskUserQuestion TUI menu expects (arrow/number/Enter), and/or the injected text queues behind
the blocking TUI rather than being delivered to it. The Chat→session bridge has no path to
answer a menu prompt; it assumes a free-text prompt.

## Proposed fix
Two complementary options (pick per design review):
- **Surface the menu in the dashboard.** When the session's read-prompt state is an
  AskUserQuestion menu (already detectable via the hook/notification state — `permission_prompt`
  has a precedent), render the options as clickable buttons in the Chat/agent view, and map a
  click to the correct keystroke (`1`..`N` / Enter) into the pane. This is the clean UX.
- **At minimum**, make a Chat message whose text matches an option label/number select that
  option in an active menu (map the free-text answer to the menu). And do not let the question
  silently time out into a default while a user is actively viewing the agent — either keep it
  open or surface the timeout to the user.

Files to investigate: `lib/session-safe-state.ts` / the read-prompt detection, the Chat→session
inject path (`aimaestro-session.sh answer` / `read-prompt` is the CLI analogue), and the
AgentChat/terminal components.

## Verification
Re-run SCEN-031: when the MANAGER raises an AskUserQuestion menu, the user answers it via the
dashboard (button click or chat), the menu advances with the chosen option (verified in the
pane), and the agent proceeds on the USER's answer — no 300s timeout, no silent default.

## Estimated risk
MED. Injecting menu keystrokes must respect the safe-state gate and not race the TUI redraw.
The button-surfacing option is more work but the correct long-term UX.

## Approval log
