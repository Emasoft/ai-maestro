---
name: restart-conversation-continuity
description: "restarted agent came back blank / forgot what it was doing / splash screen after restart / plugin install made the agent lose its task / fleet went idle after a fix"
ocd: 2026-07-23
lmd: 2026-07-23
metadata:
  node_type: memory
  type: project
  tier: component
---

Restarting an agent's session used to be a **cold start**: both restart routes
(`/api/sessions/[id]/restart`, `/api/sessions/me/restart`) build their relaunch
command with `buildRelaunchCommand()` in `lib/session-restart.ts`, which guaranteed
only `--name "<persona>"`. `claude --agent <persona>` with no `--continue` opens a
NEW conversation, so the agent returned on a splash screen with no memory of the
task it had been executing — and nothing re-delivered it.

Since **TRDD-6AMXSG3S** the builder takes `opts.continueConversation` and appends
`--continue`. Both routes derive that flag from the agent's workdir via
`lib/claude-conversation.ts`, which is the single source of truth for the lookup
key: `~/.claude/projects/<slug>/*.jsonl`, where `<slug>` is the absolute workdir
with every `/` replaced by `-`. That is the same key `claude --continue` resolves
through, which is why an agent relaunched in its own workdir continues its own
transcript and never another agent's. It is gated on `bin === 'claude'`
(`--continue` is Claude-only) AND an existing transcript (`--continue` fails with
nothing to continue), and `hasPriorConversation` returns false on every failure
path so a wrong answer costs the old cold start rather than a relaunch that dies.

**Memory is not momentum.** `--continue` restores the agent's CONTEXT; it does not
give it a turn. A resumed session sits idle at the prompt with its history loaded.
Whether an agent resumes WORKING without a human is a separate mechanism (the
janitor heartbeat / continuity daemon) — do not read this fix as solving that.

See also [[session-control-subagent-gate]] (the other half of the restart path: the
safe-state gate that decides WHEN a restart may proceed).

## Notes and lessons learned

[^1]: [id:ATOM-7K2Q-M4X8, status:valid, keywords:"restart_is_a_cold_start agent_forgot_its_task blank_session_after_restart plugin_install_destroyed_work", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT treat a session restart as a harmless "pick up the new config" step, BECAUSE
  until TRDD-6AMXSG3S it relaunched with no `--continue` and silently destroyed the
  agent's in-flight task — and `useRestartQueue` fires a restart after EVERY element
  change, so an ordinary plugin install discarded whatever the agent was doing. DO
  check that the relaunch preserves the conversation before relying on a restart.

[^2]: [id:ATOM-3F9D-P1L6, status:valid, keywords:"agent_idle_after_recovery restored_context_but_no_progress memory_is_not_momentum", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT conclude an agent is recovered because its history is back, BECAUSE
  `--continue` restores context WITHOUT giving the session a turn — it sits idle at
  the prompt looking healthy while making no progress. DO verify progress by an
  external side effect (a commit, a PR, a pane advancing), never by the transcript
  merely being present.

[^3]: [id:ATOM-8W5R-T2N7, status:valid, keywords:"fleet_went_idle blamed_the_agents harness_bug_not_agent_behaviour", ocd:2026-07-23, lmd:2026-07-23]
  DO NOT record a stalled fleet as an agent-behaviour finding before checking what the
  harness did to it, BECAUSE in SCEN-031 the fleet was working correctly and went idle
  only because a restart wiped the MANAGER's mandate — the defect was in this repo, not
  in the agents. DO capture each pane and ask "what did we do to it?" before concluding
  the agents failed.
