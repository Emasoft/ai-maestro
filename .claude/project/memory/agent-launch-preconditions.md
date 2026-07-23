---
name: agent-launch-preconditions
description: "an ai-maestro agent starts, shows up healthy in the dashboard, but says 'Not logged in' / 'API Usage Billing' and can do nothing — or its pane falls back to a shell prompt because --agent did not resolve — or it runs a live but GENERIC claude (role persona never loads, e.g. a MANAGER builds solo) because --agent was DROPPED at the launch chokepoint"
ocd: 2026-07-12
lmd: 2026-07-22
metadata:
  node_type: memory
  type: project
  tier: component
---

^agent-launch-two_silent_failures [desc: ai_maestro_launches_agent_clients_that_cannot_possibly_work_and_they_look_alive, keywords: agent says not logged in but dashboard shows it online, agent pane falls back to zsh, claude --agent exits printing the available agents list, agent looks alive but can do nothing, ocd: 2026-07-12, lmd: 2026-07-12]
ai-maestro spawns each agent as `claude --agent <main-agent>` in a tmux pane. **Two
preconditions can be false at launch, and in BOTH cases the agent still appears
healthy in the dashboard while being unable to do anything:**

1. **The pane cannot read the OAuth credential from the OS keychain.** The client
   prints `Not logged in` / `API Usage Billing` and every prompt fails. This is a
   property of the tmux server's security session, so it hits the WHOLE fleet at
   once while the developer's own session keeps working — which makes it look like a
   billing or account problem and sends the investigation in the wrong direction.

2. **The role-plugin is ENABLED but never INSTALLED.** An `enabledPlugins` entry in
   the workdir's `settings.local.json` naming a plugin that was never actually
   installed is IGNORED by Claude Code. Its main agent therefore does not exist,
   `claude --agent <name>-main-agent` exits printing the available-agents list, and
   the pane falls back to a shell prompt.

^agent-launch-preflight-contract [desc: what_the_launch_path_must_verify_before_exec_claude_and_why_refusing_beats_launching, keywords: preflight before launching an agent client, verify keychain access in the pane, verify the plugin is installed not just enabled, refuse to launch and say why, ocd: 2026-07-12, lmd: 2026-07-12]
**The launch path must verify both preconditions IN THE PANE, before `exec claude`,
and REFUSE to launch (with a clear reason) if either fails.** A refused launch is
strictly better than a launched-but-dead agent: the dead one looks alive, so nobody
investigates until work silently fails to happen.

Both checks are free — no API call, no tokens:

```sh
# 1. can this pane authenticate at all?
security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1 || refuse "no keychain access"
#    (macOS. `security list-keychains` failing at all in the pane = no keychain access whatsoever.)

# 2. is the role-plugin actually installed (not merely 'enabled')?
claude plugin list | grep -q "<role-plugin>@<marketplace>" || refuse "role-plugin enabled but not installed"
```

Never verify #2 by reading `settings.local.json` — that file records what SHOULD be
loaded, not what IS.

^agent-launch-changetitle-must-verify-install [desc: ChangeTitle_writes_enabledPlugins_without_guaranteeing_the_plugin_is_installed, keywords: ChangeTitle enables a role plugin without installing it, title cycle appears to fix an agent then it regresses, element management pipeline install gap, ocd: 2026-07-12, lmd: 2026-07-12]
Observed 2026-07-12: an agent's `ChangeTitle` had left the role-plugin **enabled in
`settings.local.json` but not installed**. A title-cycle (X → autonomous → X)
appeared to "fix" the agent — because that path happened to install it — and the
agent then **regressed on the next hibernate/wake**, which looked like a
mysterious flapping bug and was really a missing install all along.

**ChangeTitle (and any pipeline that writes `enabledPlugins`) MUST confirm the
plugin is installed** — `claude plugin list` in the workdir — and install it if not.
Writing the enable flag is not the operation; making the agent's main-agent
resolvable is.

^agent-launch-tmux-server-is-shared-fate [desc: every_agent_pane_inherits_the_tmux_servers_security_session_so_one_bad_server_takes_the_whole_fleet, keywords: whole fleet loses auth at once, restarting the agent does not help, the tmux server is the poison not the client, recreate the server from a healthy context, ocd: 2026-07-12, lmd: 2026-07-12]
**All agent panes are forked by ONE long-lived tmux server, so they share its fate.**
If that server's security session loses keychain access, restarting individual
agents changes NOTHING — a fresh child of a poisoned parent is still poisoned. The
server itself must be replaced, and the replacement must be created from a context
that has been VERIFIED healthy (do not assume the supervising daemon's own session
is healthy — it is typically just as long-lived).

Implication for ai-maestro: the health of the tmux server is a **fleet-wide single
point of failure** that nothing currently monitors. A pane-level preflight (above)
turns it from a silent fleet outage into an explicit, diagnosable refusal.

Related: the general platform knowledge lives in the user-scope notes
`claude-code-client-authentication` and `macos-keychain-access-inheritance`.

^agent-launch-agent-flag-dropped [desc: role_plugin_installed_but_--agent_dropped_at_launch_so_agent_runs_a_live_generic_claude, keywords: titled agent runs generic claude persona never loads, MANAGER builds the project solo instead of creating a fleet, agent is logged in and alive but not running its role persona, --agent missing from ps argv though registry programArgs has it, fresh Wizard-created titled agent has no --agent in its process, ocd:2026-07-22, lmd:2026-07-22]
**Third silent failure — the MOST insidious, because the agent is genuinely ALIVE and
LOGGED IN** (not "Not logged in" #1, not a shell prompt #2). The role-plugin is installed AND
enabled — `--agent` WOULD resolve — but the launch command **drops `--agent` entirely**, so
the pane runs a live, working GENERIC `claude`. The plugin's rules+skills load, but the
role-plugin main-agent BEHAVIOURAL prompt does not, so the agent acts like vanilla Claude:
e.g. a MANAGER told "build X and create a fleet" builds X SOLO with its own Claude Code
subagents and creates ZERO ai-maestro personas (SCEN-031, 2026-07-22).

Root cause (ai-maestro CreateAgent, verified): G04 stores the default `programArgs`
(`--dangerously-skip-permissions`, NO `--agent`); G06 ChangeTitle injects `--agent` into the
REGISTRY; but the launch chokepoints build the tmux command from a stale/param `programArgs`
captured BEFORE G06 — so `--agent` is absent from the actual argv even though the registry
now carries it. `sanitizeArgs` is NOT the stripper (its allowlist keeps `--agent`). **Diagnose
by the LIVE process argv, never by liveness:** `ps -eo pid,command` then grep for `--agent` — a
booting REPL is not proof the persona loaded.

Fix (TRDD-GZ1KOHNR, commits eff07647 + 2bd8969c): derive `--agent` from the INSTALLED
role-plugin (`RolePlugin.mainAgentName` via `scanAgentLocalConfig`) AT every launch/restart
chokepoint — one shared helper `services/agent-launch-args.ts::resolveLaunchArgs`, wired into
createSession, wakeAgent, and the 4 restart sites (`[id]`/`me` routes + 2 headless handlers).
Non-Claude programs + agentless sessions pass through; a Claude agent with no resolvable
persona is REFUSED (fail-fast, R9.13), mirroring the keychain refuse. Derive at launch from
the role-plugin (the source of truth), NOT from stored programArgs — the stored copy can be
stale. See also `scen031-manager-role-violation-not-substrate`.

## Governed by

General debugging discipline this page's own `[^1]` lesson applies now lives on the
USER-scope aspect page `debugging-methodology` (cross-scope; referenced in prose,
not as a `[[wikilink]]`, per the link-hygiene rule).

## Notes and lessons learned

[^1]: [ocd:2026-07-12 lmd:2026-07-12] This was found the hard way: the entire fleet
  was unauthenticated for hours while the dashboard showed every agent online. The
  investigation burned a long time on the wrong layer (subscription, API keys,
  settings files, containers, model flags, env vars, workdir) because the agents
  LOOKED fine and the failure was scoped to a process context rather than to any
  piece of configuration. The preflight exists to make that class of failure loud and
  immediate instead of silent and fleet-wide.

[^2]: [ocd:2026-07-13 lmd:2026-07-13] Both gates + the fleet watchdog are now LIVE
  (TRDD-CNF1X3J7 commits fb8c03ea, TRDD-78J4I4QS commits 6eef63fe+fcd0fa5b). Lesson
  from the watchdog's FIRST production sweep: a fail-safe detector that uses a
  fixed-name throwaway resource MUST pre-clean its own leftover, or its own debris
  becomes a false fleet-wide alarm — a stale `aim-kc-watchdog` session made
  `createSession` fail "duplicate session", and fail-safe ("cannot prove ⇒ blind")
  faithfully reported a healthy server as blind. Corollary: when a comment promises
  cleanup-by-name ("the fixed name exists so leftovers can be killed by name"),
  verify the CODE implements it — the promise had been written, the pre-kill hadn't.

[^3]: [ocd:2026-07-13 lmd:2026-07-13] Resolving WHICH plugin is an agent's role in
  the enabled-but-not-installed state cannot use the scanner: the quad-match only
  sees plugins whose files exist on disk, so it returns null in exactly the broken
  state. The truthful fallback is the agent's own launch args — `--agent
  <plugin>-main-agent` names precisely what the client will try (and fail) to load.
  Implemented in the `role-plugin` invariant row (lib/agent-invariants.ts).

[^4]: [ocd:2026-07-14 lmd:2026-07-14] The janitor's `memory-scope-leak` detector flags
  this page as `machine-host` and proposes demoting it to LOCAL. **Verified 2026-07-14:
  false positive — do NOT demote it.** The page carries no username, no `$HOME` path, no
  hostname, no credential and no one-box install state; it passes the write gate cleanly
  (*"would this be TRUE and USEFUL for a stranger who clones this repo on a DIFFERENT
  machine?"* — yes: it is ai-maestro's launch-path contract). The heuristic fires on the
  vocabulary — "keychain", "macOS", "tmux server" — not on any private datum. Demoting it
  would strip the fleet-outage lesson and the preflight contract from every contributor,
  which is the opposite of what the scope rule protects. Lesson: a scope-leak finding is a
  *candidate*, not a verdict; read the page before you move it, and record the verdict here
  so the next sweep does not re-litigate it.

[^5]: [id:ATOM-ALP5-AGDROP, status:valid, keywords:"live_REPL_not_proof_persona_loaded verify_process_argv_via_ps --agent_dropped_at_launch generic_claude MANAGER_builds_solo derive_--agent_from_installed_role_plugin_at_launch stale_programArgs", ocd:2026-07-22, lmd:2026-07-22]
  DO NOT conclude a titled agent's role persona is active just because it came up a live,
  logged-in REPL, BECAUSE `--agent` can be DROPPED at the launch chokepoint — the fresh MANAGER
  ran `claude --dangerously-skip-permissions` with no `--agent` though the registry programArgs
  carried it (CREATE stores the default no-`--agent` args at G04; ChangeTitle injects `--agent`
  into the registry at G06; the launch built the command from a stale/param copy captured before
  G06). A fully-alive agent was silently running GENERIC claude and built its project solo. DO
  inspect the actual launched process argv (`ps -eo pid,command`) for `--agent`, and derive the
  flag from the INSTALLED role-plugin AT launch (not from possibly-stale stored programArgs) —
  enforced now by TRDD-GZ1KOHNR (`services/agent-launch-args.ts`, commits eff07647+2bd8969c).
