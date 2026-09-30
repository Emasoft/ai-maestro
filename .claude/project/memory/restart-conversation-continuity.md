---
name: restart-conversation-continuity
description: "restarted agent came back blank / forgot what it was doing / splash screen after restart / plugin install made the agent lose its task / fleet went idle after a fix"
ocd: 2026-07-23
lmd: 2026-09-30
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
publish-globally: false
---

^P2GZ9D6H [desc: "Before TRDD-6AMXSG3S both restart routes cold-started: buildRelaunchCommand guaranteed only --name, so claude --agent <persona> with no --continue opened a NEW conversation — the agent returned on a splash screen with no memory of its in-flight task.", keywords: restarted_agent_came_back_blank forgot_what_it_was_doing splash_screen_after_restart restart_wiped_in_flight_task cold_start_on_restart buildRelaunchCommand_no_continue claude_agent_without_continue_new_conversation restart_route_cold_start useRestartQueue_fires_after_every_change, ocd: 2026-07-23, lmd: 2026-09-30]
Restarting an agent's session used to be a **cold start**: both restart routes
(`/api/sessions/[id]/restart`, `/api/sessions/me/restart`) build their relaunch
command with `buildRelaunchCommand()` in `lib/session-restart.ts`, which guaranteed
only `--name "<persona>"`. `claude --agent <persona>` with no `--continue` opens a
NEW conversation, so the agent returned on a splash screen with no memory of the
task it had been executing — and nothing re-delivered it.

^Q5VK3N8R [desc: "Since TRDD-6AMXSG3S the builder takes opts.continueConversation and appends --continue; both routes derive it via lib/claude-conversation.ts — the SSOT lookup key ~/.claude/projects/<slug>/*.jsonl where slug is the workdir with every / replaced by -.", keywords: how_does_restart_preserve_conversation continueConversation_flag claude_conversation_lookup_key projects_slug_jsonl workdir_slash_replaced_by_dash transcript_lookup_single_source_of_truth TRDD_6AMXSG3S --continue_relaunch, ocd: 2026-07-23, lmd: 2026-09-30]
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

^S8LW4F1B [desc: "Memory is not momentum: --continue restores the agent's CONTEXT but does not give it a turn — a resumed session sits idle at the prompt. Resuming WORK without a human is a separate mechanism (janitor heartbeat / continuity daemon).", keywords: memory_is_not_momentum continue_restores_context_not_a_turn resumed_session_sits_idle agent_recovered_but_not_working who_gives_resumed_session_a_turn janitor_heartbeat_continuity_daemon context_restored_no_progress, ocd: 2026-07-23, lmd: 2026-09-30]
**Memory is not momentum.** `--continue` restores the agent's CONTEXT; it does not
give it a turn. A resumed session sits idle at the prompt with its history loaded.
Whether an agent resumes WORKING without a human is a separate mechanism (the
janitor heartbeat / continuity daemon) — do not read this fix as solving that.

^T3HJ7M5D [desc: "The BOOT-RESTORE path was a second, separate cold start (closed by TRDD-NIU5RQ1S): wakeAgent built its command from startCommand + resolveLaunchArgs and never added a resume verb — agents restored after a server restart came back having forgotten everything.", keywords: boot_restore_cold_start second_relaunch_path wakeAgent_no_resume TRDD_NIU5RQ1S agent_restored_after_server_restart_forgot_everything relaunch_command_built_in_two_places startCommand_resolveLaunchArgs, ocd: 2026-07-25, lmd: 2026-09-30]
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
