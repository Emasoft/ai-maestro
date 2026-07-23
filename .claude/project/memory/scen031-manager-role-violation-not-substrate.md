---
name: scen031-manager-role-violation-not-substrate
description: "SCEN-031 fleet-ship FAILs — MANAGER builds the project solo instead of creating+delegating to fleet personas; and why the earlier '--agent unresolvable / role agents dead on arrival' root cause was a FALSE NEGATIVE"
ocd: 2026-07-22
lmd: 2026-07-22
metadata:
  node_type: memory
  type: project
  tier: component
---
SCEN-031 (zipsearcher end-to-end fleet-ship readiness proof) FAILs, and the harness is
NOT ready — but for a **role-behaviour** reason, not a substrate reason.

**Real blocker:** given the one-sentence build brief, the fresh Wizard-created MANAGER
built zipsearcher **SOLO** — created `Emasoft/zipsearcher` itself, cloned it into its own
workdir, developed it with its **own Claude Code Task-tool subagents** — and created
**ZERO** ai-maestro fleet personas (no AUTONOMOUS, no MAINTAINER; registry snapshot-diff
confirms). It never delegated via AMP. That is an **R6/R9 governance violation**: a MANAGER
must ORCHESTRATE (create fleet personas + delegate), not EXECUTE the dev work. Fix lives in
the MANAGER role-plugin persona (`agents/ai-maestro-assistant-manager-agent-main-agent.md`),
a SEPARATE Emasoft repo → cross-project, so it was filed as an **issue, not an in-place edit**:
`github.com/Emasoft/ai-maestro-assistant-manager-agent/issues/31`. In-repo Rule-11 counterpart:
proposal `TRDD-F898NXLU`. Readiness TRDD: `TRDD-B7G2R0SX` (its STATE block is authoritative).

**REFINED root cause (USER-confirmed 2026-07-22): the harness DROPS `--agent` at the CREATE
launch, so a freshly-created titled agent runs GENERIC claude — its persona never loads.**
The plugin install/resolution is fine (a role plugin installed `--scope local` by
`CreateAgent`→`installPluginLocally` makes `claude --agent <plugin>-main-agent` resolvable by
name). The bug is the LAUNCH: the fresh MANAGER's live process was `claude
--dangerously-skip-permissions` with `--agent` **dropped**, though the registry `programArgs`
carry it. Corroborated fleet-wide (`ps` snapshot: 0 of 13 running titled agents carry
`--agent`) and by OQIA2DCR point 2 ("CREATE does not pass programArgs → plain claude, no role
persona"). So the MANAGER built solo because it WAS generic claude, not because its persona
told it to. USER directive: **the `--agent` spec MUST be ENFORCED — no agent may be executed
without it.** FIX LANDED: TRDD-GZ1KOHNR (commits eff07647 + 2bd8969c) — `services/agent-launch-args.ts`
derives `--agent` from the installed role-plugin at every launch/restart chokepoint (createSession,
wakeAgent, the 4 restart sites); refuses fail-fast if a Claude agent has no resolvable persona.
Issue #31 (persona mandate) is SECONDARY — it can only be judged after a re-run confirms the
persona now loads. The launch-pipeline mechanics + the "diagnose by process argv" rule live on the
component page `[[agent-launch-preconditions]]` (its third silent-failure block + `[^5]`).

## Notes and lessons learned
[^1]: [id:ATOM-SC31-FNEG, status:valid, keywords:"role_plugin_agents_dead_on_arrival --agent_unresolvable claude_--agent_not_found bare_shell TRDD-OQIA2DCR false_negative stale_agents", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT conclude a fresh-creation path is broken by observing STALE/pre-existing agents,
  BECAUSE SCEN-031 run 1 blamed the FAIL on `--agent <plugin>-main-agent` being unresolvable
  (TRDD-OQIA2DCR) purely from 4 old agents and NEVER created a fresh MANAGER — a re-run that
  actually created one proved the persona loads fine. DO exercise the real fresh path (create
  the agent via the Wizard, then observe) before root-causing.
[^2]: [id:ATOM-SC31-UICODE, status:valid, keywords:"verify_harness_via_UI not_via_code scenario_rules_violation edit_code_to_fix", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT verify/fix the ai-maestro harness by editing code or out-of-band `claude` probing,
  BECAUSE the USER's scenario rules require driving the ai-maestro UI as a normal user would;
  code-diving is itself a rule violation. DO run the scenario through the dashboard UI and let
  the fleet behave (or misbehave) on its own — an agent you had to steer has told you nothing.
[^3]: [id:ATOM-SC31-REPLBOOT, status:valid, keywords:"REPL_boots_but_persona_not_loaded --agent_dropped_at_launch ps_argv_check substrate_works_conclusion", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT conclude "persona loaded / substrate fully works / don't chase a --agent fix" merely
  because the agent came up as a LIVE Claude REPL, BECAUSE a REPL boots even when `--agent` is
  dropped — it just runs the GENERIC agent; the fresh MANAGER's live argv (via `ps`) was
  `claude --dangerously-skip-permissions` with `--agent` absent though the registry programArgs
  carried it. DO inspect the actual launched process argv with `ps` (not just "is it a REPL?")
  before ruling on whether the role persona is active.
