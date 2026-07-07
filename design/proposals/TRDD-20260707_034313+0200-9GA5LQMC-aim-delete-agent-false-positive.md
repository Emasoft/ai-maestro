---
trdd-id: 9GA5LQMC
title: Gate aim_delete_agent success on a verified post-condition to stop false-positive cleanup
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: HIGH
effort: S
labels: [scenario-improvement, scen-020, batch-backlog-20260707]
task-type: bugfix
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_020_20260625T153541Z.md"]
---

# TRDD-9GA5LQMC — aim_delete_agent returns false-positive success

## Problem

In SCEN-020 (2026-06-25) `aim_delete_agent` returned `{"ok":true,"deleted":"scen020-…"}`
while the agent was NOT deleted (registry entry, folder, and tmux session all still
present). The helper had internally emitted `{"ok":false,"reason":"no sudo modal visible"}`
plus a JS error, then printed the bogus success line anyway. A runner trusting the helper
leaks the test agent — silently defeating Rule 1 (CLEAN-AFTER-YOURSELF) and Rule 2
(0-IMPACT) for the whole suite. Verified 2026-07-07:
`tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` (~line 511) still has no
post-condition check before its success line.

## Root cause

The multi-stage delete sequence (Advanced → Danger Zone → dialog → sudo) is not gated on a
post-condition; the terminal `console.log({ok:true})` fires regardless, overriding the
intermediate failure signal.

## Proposed fix

In `aim_delete_agent`: (1) propagate the internal "no sudo modal visible" failure as a
non-zero return instead of falling through; (2) before echoing success, verify the agent
actually vanished — a dev-browser evaluate confirming the name is gone from the sidebar,
returning `{"ok":false,"reason":"agent still present after delete"}` when it is not.

## Verification

Interrupt the delete UI flow (e.g. wrong password path) → helper returns `ok:false`;
normal delete → `ok:true` only after registry entry + folder + tmux session are confirmed
gone.

## Estimated risk

LOW — test-infra only; makes every scenario cleanup trustworthy.

## Approval log
