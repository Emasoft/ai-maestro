---
trdd-id: OQIA2DCR
title: Every titled agent launches with an unresolvable --agent, so a woken agent is dead on arrival
column: proposal
approval-tier: 2
priority: 0
severity: critical
effort: medium
task-type: bugfix
created: 2026-07-15T01:05:00+0200
updated: 2026-07-22T20:13:00+0200
scope: project
labels: [scenario-improvement, scen-029, scen-031]
current-owner: scenario-runner
external-refs:
  - reports/scenarios-runner/SCEN-029_20260714T212851Z.report.md
  - reports/scenarios-runner/SCEN-031_20260722T201234Z.report.md
---

# Role-plugin main-agents do not resolve, so `claude --agent` exits and the agent lands at a shell

## Problem

`lib/program-args.ts` launches every titled agent as:

```
claude --agent <plugin-name>-main-agent --dangerously-skip-permissions
```

That name **does not resolve**. Observed live in SCEN-029 on the auto-created
CHIEF-OF-STAFF (`cos-scen029team`), whose tmux pane contains:

```
unset CLAUDECODE; claude --agent ai-maestro-chief-of-staff-main-agent --dangerously-skip-permissions
--agent 'ai-maestro-chief-of-staff-main-agent' not found. Available agents: aegis, ai-maestro-janitor:...
```

Claude exits immediately and the pane falls back to a bare `zsh` prompt — while
the registry says `status: active` and the dashboard renders the agent **green /
online**. The agent is dead on arrival and nothing anywhere says so.

This is not specific to the COS. Reproduced directly from the MANAGER's own
working directory:

```
$ cd ~/agents/scen029-manager-01
$ claude --agent ai-maestro-assistant-manager-agent-main-agent --print hi
--agent 'ai-maestro-assistant-manager-agent-main-agent' not found. Available agents: ...
```

Claude sees **73 agents from that workdir and not one role-plugin agent** — the
only `ai-maestro-*` entries are the janitor's, and they are namespaced
(`ai-maestro-janitor:janitor-security-agent`). The plugin-namespaced form does not
resolve either.

## SCEN-031 reconfirmation (2026-07-22) — STILL LIVE, and it is a total blocker for the fleet-ship proof

SCEN-031 (the end-to-end "does the fleet ship real software from one sentence?"
proof) cannot begin because of this bug. Reproduced the SAME DAY across **four
independent live agent panes** (`ecos-chief-of-staff-one`, `scen017-ui-test`,
`e2e-ctl-1783769585`, `e2e-br-1783777802`), each woken with
`claude --agent ai-maestro-autonomous-agent-main-agent …` and each printing
`--agent 'ai-maestro-autonomous-agent-main-agent' not found. Available agents: …`
then falling to a bare `emanuelesabetta@Mac-mini-di-Emanuele <session> %` shell.
The `e2e-*` agents were created earlier the same day (16:31), so this is the
CURRENT wake pipeline, not stale state.

The printed "Available agents" list contains **zero** `ai-maestro-*-main-agent`
entries — including the MANAGER persona `ai-maestro-assistant-manager-agent-main-agent`
that SCEN-031's S004 MANAGER would use. Consequence chain for SCEN-031:
the runner's S006 brief has **no REPL to land in** (the MANAGER is a bare shell),
so the MANAGER never creates the AUTONOMOUS/MAINTAINER, never writes a TRDD, never
delegates — every one of the fleet-autonomy behaviours the scenario exists to
measure is unobservable. **SCEN-031 verdict: FAIL (harness NOT ready), root-caused
to THIS TRDD.** The runner deliberately did not create the S004 MANAGER, because
the outcome is already determined (a dead-on-arrival bare shell) and creating one
adds cleanup/residue risk for zero verdict value — 0-IMPACT was preserved (zero
state mutations).

Note the launch token has drifted slightly since SCEN-029: some panes now show
`unset CLAUDECODE; claude --agent … --dangerously-skip-permissions` and others
`claude --dangerously-skip-permissions --chrome --add-dir /tmp --agent …`, but the
unresolvable bare `--agent <plugin>-main-agent` name is identical in every case.

## Root cause

The role-plugin *is* installed and enabled at LOCAL scope —
`~/agents/<name>/.claude/settings.local.json` contains
`"ai-maestro-chief-of-staff@ai-maestro-plugins": true` — and the cache carries a
correctly-named `agents/ai-maestro-chief-of-staff-main-agent.md` whose frontmatter
`name:` matches (the fourfold identity rule holds). But **Claude Code does not
expose a LOCAL-scope plugin's agents as `--agent` targets**. The janitor, which is
installed at USER scope, *is* exposed. Scope — not naming — is the discriminator.

Two consequences compound:

1. **WAKE passes `programArgs`** → claude exits → dead shell. This is what killed
   the SCEN-029 fleet chain: the MANAGER correctly authored a TRDD and AMP-routed
   it to the COS (the message *was* delivered to the COS inbox), and the COS never
   ran a single tool because its client was not running.
2. **CREATE apparently does not pass them**, so a freshly-created agent comes up on
   plain `claude` — alive, but running **no role persona at all**. That masks (1)
   until the first wake, and it means titled agents have been running without their
   role-plugin persona.

## Proposed fix

Decide the scope question first, then make the launch honest:

1. Establish how a role-plugin's main-agent becomes visible to `claude --agent`
   (USER-scope install? an `agents/` path exposed via the plugin manifest?
   the `plugin:agent` namespace?). Fix installation so it resolves — this is the
   real fix and it belongs with the R9.13 role-plugin work.
2. **Fail loudly, never silently.** `lib/agent-runtime.ts` already knows how to
   detect that the foreground command is a shell (`getForegroundCommand`,
   `waitForShellReady`, added for the SCEN-015 launch bug). Extend the wake path:
   after launching, if the pane is back at a shell prompt, mark the agent
   `client_failed` rather than `active`, surface it in the sidebar, and log the
   `--agent ... not found` line. An agent the UI reports as online but which cannot
   process a message is worse than one reported as offline.
3. Make CREATE and WAKE use the **same** launch path, so a create-time agent and a
   woken agent are the same agent. Right now they demonstrably are not.

## Verification

- `claude --agent <resolved-name>` exits 0 from a fresh agent workdir.
- Wake a titled agent; `tmux capture-pane` shows the Claude banner, not a `%` prompt.
- Re-run SCEN-029: the MANAGER's AMP mandate reaches the COS, the COS relays to the
  MEMBER, and `CONTRIBUTING.md` appears in the MEMBER's workdir.
- A deliberately-broken `--agent` must leave the agent NOT green in the sidebar.

## Estimated risk

MED. Changing the launch args affects every agent on every host. The
fail-loudly half (2) is low-risk and can land first; it converts a silent
fleet-wide failure into a visible one.

## Approval log
