---
name: restart-conversation-continuity
description: "restarted agent came back blank / forgot what it was doing / splash screen after restart / plugin install made the agent lose its task / fleet went idle after a fix"
ocd: 2026-07-23
lmd: 2026-07-25
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

**The BOOT-RESTORE path was a second, separate cold start**, closed later by
TRDD-NIU5RQ1S: `wakeAgent` built its command from `startCommand + resolveLaunchArgs()`
and never added a resume verb, so an agent restored after a server restart came back
alive, in the right repo, and having forgotten everything. It now takes
`continueConversation`, and the decision lives in `decideResume()` alongside
`hasPriorConversation` — per-client (read from `getClientCapabilities().cli.resume`),
and FLAG-FORM only: codex `resume --last` / kiro `chat --resume` are subcommands that
must precede other args, so appending them would build an *invalid* command, which is
worse than the cold start it replaces.

See also [[session-control-subagent-gate]] (the other half of the restart path: the
safe-state gate that decides WHEN a restart may proceed) and [[pm2-boot-persistence]]
(the layer BELOW this one: whether the server comes back at all after a reboot).

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

[^4]: [id:ATOM-6P4J-V9SD, status:valid, keywords:"fixed_the_restart_path_but_boot_restore_was_still_cold second_relaunch_path relaunch_command_built_in_two_places", ocd:2026-07-25, lmd:2026-07-25]
  DO NOT treat "relaunch preserves the conversation" as settled once the restart routes
  are fixed, BECAUSE a SECOND relaunch path existed — boot-restore's `wakeAgent` builds
  its own command and kept cold-starting every agent after a server restart for months
  after TRDD-6AMXSG3S closed the first one. DO grep for every site that assembles a
  launch command, not just the one the bug was reported against.
