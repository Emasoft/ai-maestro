---
trdd-id: 7WYT5ERU
title: Show an installing-state signal while role-plugin install lags the title-change confirmation
column: refused
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-7WYT5ERU — Show an installing-state signal while role-plugin install lags the title-change confirmation

## Problem
SCEN-002 S048: immediately after an ORCHESTRATOR title-change sudo
confirmation, the agent's `settings.local.json` briefly showed only
`ai-maestro-plugin` (no orchestrator role-plugin entry); after ~6 seconds
the orchestrator plugin appeared. The governance title itself is set
synchronously, but the underlying role-plugin install (per the
`ChangeTitle` pipeline documented in CLAUDE.md's "Title → Role-Plugin
Auto-Assignment" section) completes asynchronously. A user watching the
Agent Profile Config tab during that ~6s window sees no indication that
install is still in progress and might reasonably conclude the operation
failed.

## Root cause
This is expected/documented async behavior (plugin install genuinely takes
time — it shells out to `claude plugin install ...`), not a bug in the
underlying pipeline. The gap is purely a missing UI affordance: no loading/
installing state is surfaced in the Config tab between the title-change
confirmation and install completion, and no re-render is guaranteed to pick
up the newly-installed plugin without a manual tab switch or refresh.

## Proposed fix
1. In the Agent Profile Config tab (`components/AgentProfilePanel.tsx` or
   wherever the plugin list for the Config sub-tab is rendered), after a
   title-change is confirmed, show a transient "Installing role-plugin…"
   indicator (spinner + label) scoped to the agent whose title just
   changed, until the expected role-plugin appears in the agent's scanned
   local config.
2. Ensure the Config/Overview tab state re-renders automatically when the
   install completes (e.g. via existing polling infra such as
   `useRestartQueue`/`useSessionActivity`-style polling, or an event the
   `ChangeTitle` pipeline emits) rather than requiring a manual tab switch
   or page refresh to observe the new plugin.

## Verification
1. After a title change that triggers a role-plugin swap, the Config tab
   shows an "Installing…" state immediately, then automatically updates to
   show the new plugin once install completes — no manual refresh needed.
2. Re-run SCEN-002 S048 and confirm the ~6s gap is now visibly explained by
   the installing indicator rather than appearing as a silent, unexplained
   delay.

## Estimated risk
LOW. Purely additive UI polish (a loading indicator + auto-refresh); does
not change the underlying `ChangeTitle`/plugin-install pipeline timing or
behavior.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Cosmetic async-lag signal; NIT.
