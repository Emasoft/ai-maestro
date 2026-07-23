---
trdd-id: Z1VNCV3U
title: The MANAGER staffs a portfolio correctly but never dispatches — workers created, never woken, never messaged
column: proposal
created: 2026-07-23T19:10:18+0200
updated: 2026-07-23T19:14:00+0200
current-owner: scenario-runner
task-type: bugfix
scope: project
min-approval-requirement: manager
priority: 0
severity: critical
effort: medium
labels: [scenario-improvement, scen-031, phase-1, manager-behaviour]
external-refs: [reports/scenarios-runner/SCEN-031-phase-1b_20260723T170147Z.report.md]
---

# The MANAGER organizes a portfolio but does not delegate it

## Problem

Observed in the SCEN-031 v2.0 (three-project portfolio) run, burst 1b. From one directive the MANAGER
did the hard part **correctly and concurrently**: within a ~70-second window it authored three
requirement documents, created three GitHub repos, and created six worker agents — one AUTONOMOUS dev
+ one MAINTAINER per project, none dropped, none serialized. The portfolio-organization test passed.

Then it **stalled at the hand-off**:

- **Zero AMP messages sent** (`~/.agent-messaging/agents/<mgr-uuid>/messages/sent/` empty).
- **All six worker agents never woken** — every one shows `sessions[0].status: no-session`; only the
  MANAGER has a live tmux session.
- **No `design/` board** in any of the three repos (no shared kanban for a pair to work from).
- The MANAGER sits **idle**, banner reading "Standing by for the three build completions" — waiting on
  work it never assigned to anyone.
- Yet real product code appears (e.g. `Emasoft/zipsearcher` PR #5 `feat: implement zipsearcher v1.0.0`)
  — strongly implying the MANAGER is **doing the implementation itself** rather than delegating to the
  AUTONOMOUS devs it created.

So the MANAGER treats "create the worker" as the end of delegation, when it is the start. It never
performs the dispatch that R42 requires (a directive is an AMP message that wakes the worker and hands
it its TRDD), and then either does the work itself or waits forever on unassigned work.

## Root cause (hypothesis — to confirm)

The MANAGER role-plugin (`ai-maestro-assistant-manager-agent`, a separate repo) has no step that, after
creating a worker, (a) wakes its session, (b) sends it the AMP dispatch carrying its requirements TRDD,
and (c) tracks it as in-flight. Its persona appears to model "I have staffed the team" as sufficient,
so it transitions straight to "await completion" — a completion that can never arrive.

## Proposed fix

Because the behaviour lives in a **cross-repo** role-plugin, the fix routes as a **Method-1 issue on
`Emasoft/ai-maestro-assistant-manager-agent`** (this TRDD is the scenario-side record; the plugin owns
the change). The issue should ask the MANAGER persona to, for each staffed project:

1. WAKE the worker's session (it cannot act while `no-session`).
2. SEND the AMP dispatch message carrying that project's requirements TRDD (R42: a directive is a
   message, never a keystroke) — and only THEN consider the project dispatched.
3. Establish the shared `design/` board before "await completion", and
4. NOT implement the work itself — delegation to the AUTONOMOUS dev is the whole point; a MANAGER that
   codes is a MANAGER not managing.

Also confirm the server side: if `send-command`/wake is R42-gated such that the MANAGER *cannot* wake a
worker it created, that is a capability gap to file separately (relates to ai-maestro#89).

## Verification

Re-run SCEN-031 burst 2a: for each project an AMP message `from: <manager> to: <that project's dev>`
carrying its TRDD exists, each worker session is awake, and product PRs come from the DEVS' forks, not
from the MANAGER directly.

## Estimated risk

MEDIUM. Cross-repo (MANAGER plugin) + possibly a server capability gap. High value: without it the
whole multi-agent delegation model is decorative — one agent does everything while six sit idle.

## Corroboration (independent burst 1b run, 2026-07-23T19:14+0200)

A second, independent verification pass (SCEN-031-phase-1b,
`reports/scenarios-runner/SCEN-031-phase-1b_20260723T170147Z.report.md`) confirms this finding with
additional end-state evidence:

- All **three** projects (not just zipsearcher) now carry a `feat: implement <name> v1.0.0` PR,
  pushed within the 17:08-17:10Z window: zipsearcher #5 MERGED, tarot-reader #4 OPEN,
  weather-reporter #4 OPEN.
- **All six worker agents' sessions remained `no-session` for the entire observed window** — none
  was ever woken, confirmed via registry `sessions[0].status` both before and after the three PRs
  landed.
- The MANAGER's own AMP `sent/` mailbox stayed at **0 messages** throughout.
- The only live tmux session for the whole portfolio, start to finish, was the MANAGER's own.

This rules out a race where a worker was briefly woken out-of-band and missed by the first
observation — the six workers never had a session at any point this run captured. The hypothesis
in "Root cause" above (the MANAGER implements instead of delegating) is now the best-supported
explanation, not merely a hypothesis to confirm.

## Approval log

(empty — awaiting screening)
