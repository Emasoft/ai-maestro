---
name: session-control-subagent-gate
description: "restart API times out 504 / stop refused with subagents_running / /exit lands on a confirmation dialog instead of exiting / agent badge shows 'Waiting (N subagents)' / is idle_prompt still the safe state — the CC >=2.1.198 background-subagents gate (TRDD-O8NCNRWO)"
ocd: 2026-07-08
lmd: 2026-09-30
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
publish-globally: false
---

# Stop/restart safe-state gate for CC ≥2.1.198 background subagents (TRDD-O8NCNRWO)

^9WV5R2KD [desc: "CC 2.1.198 made background subagents the DEFAULT: the main session hits idle WHILE subagents run, and /exit lands on the abandon dialog — breaking 'idle_prompt implies safe to stop/restart'.", keywords: restart_API_times_out_504 stop_refused_subagents_running exit_lands_on_confirmation_dialog agent_badge_Waiting_N_subagents is_idle_prompt_still_the_safe_state CC_2_1_198_background_subagents_default abandon_confirmation_dialog_on_exit, ocd: 2026-07-08, lmd: 2026-09-30]
Claude Code 2.1.198 made **background subagents the default**: a main session reaches its
idle input prompt WHILE subagents keep running, and `/exit` then lands on Claude's
abandon-confirmation dialog (2.1.203's changelog confirms it fires whenever background
agents are genuinely running). That broke ai-maestro's old premise
"`idle_prompt` ⟹ no subagents ⟹ safe to stop/restart".

**The fix (all landed 2026-07-08):**

^8RC3F5XN [desc: "The fix (TRDD-O8NCNRWO, 2026-07-08): lib/session-safe-state.ts is the SINGLE server-side reader of subagentCount; stop+restart refuse 409 subagents_running when provably >0; ?force=true bypasses.", keywords: session_safe_state_single_reader evaluateExitGate_readSubagentCount looksLikeAbandonPrompt stop_restart_409_subagents_running force_true_bypasses_gate TRDD_O8NCNRWO fix_landed, ocd: 2026-07-08, lmd: 2026-09-30]
- `lib/session-safe-state.ts` — the SINGLE server-side reader of the hook's chat-state
  `subagentCount` (`readSubagentCount` / `evaluateExitGate` / `looksLikeAbandonPrompt`).
- Stop + restart routes refuse with **409 `{error:'subagents_running', subagentCount}`**
  when the counter is provably >0; `?force=true` preserves the old unconditional behavior.

^9TD6G2WK [desc: "The restart poll probes the pane ONCE at half-timeout: if the abandon dialog is visible it presses Enter — never blind keys — and the 504 carries a hint; badge flows to 'Waiting (N subagents)'.", keywords: restart_poll_probes_pane_half_timeout presses_enter_on_abandon_dialog never_blind_keys_unknown_UI 504_carries_dialog_hint subagentCount_getHookState_flow resolveAgentStatus_waiting_N_subagents useRestartQueue_holds_deferred_restart, ocd: 2026-07-08, lmd: 2026-09-30]
- The restart poll probes the pane ONCE at half-timeout: if the abandon dialog is visible
  it presses Enter (the dialog default) — never blind keys into an unknown UI — and the
  504 now carries a hint naming the dialog.
- UI: `subagentCount` flows getHookState → `/api/sessions/activity` →
  `useSessionActivity` → `resolveAgentStatus` ("Waiting (N subagents)", darker amber +
  clock, threaded through AgentBadge / AgentStatusIndicator / AgentProfile /
  TaskKanbanBoard); `useRestartQueue` holds the deferred restart while subagents are
  provably live (courtesy check — the server 409 is the enforcer).

^2VH7J9PL [desc: "THE TRUST MODEL: only a PROVEN positive counter blocks — null/absent/0 NEVER blocks; the hook REPLACES its state file on idle_prompt, dropping subagentCount (plugin#17, stale-LOW).", keywords: trust_model_only_positive_counter_blocks null_counter_never_blocks hook_replaces_state_file_drops_subagentCount stale_LOW_direction plugin_17_abandon_dialog_backstop fail_safe_would_wedge_restart_forever, ocd: 2026-07-08, lmd: 2026-09-30]
**THE TRUST MODEL (load-bearing — do not "simplify" it away):** only a PROVEN positive
counter blocks. A `null`/absent/`0` counter NEVER blocks, because the hook currently
REPLACES its state file on `idle_prompt` and drops `subagentCount`
(**Emasoft/ai-maestro-plugin#17** — stale-LOW). Absence of evidence is not evidence of
safety, and blocking on unknown would brick stop/restart for every agent whose hook
predates the counter.[^1] The positive-path live e2e (an actual 409 with a real background
subagent) is only observable after plugin#17 ships.

^4KM8B3ZR [desc: "Same bug class client-side: useSessionActivity's WS status_update handler used to REPLACE the per-session entry, dropping poll-sourced subagentCount — it now MERGES over the previous entry.", keywords: useSessionActivity_ws_status_update_replace_bug replace_not_merge_dropped_subagentCount merged_over_previous_entry client_side_same_bug_class per_key_state_spread_prev, ocd: 2026-07-08, lmd: 2026-09-30]
Same bug class appeared client-side: `useSessionActivity`'s WS `status_update` handler
used to REPLACE the per-session entry — which would drop the poll-sourced `subagentCount`
on the first WS event. It now MERGES over the previous entry.[^2]

Docs: CLAUDE.md §Session Control Architecture (corrected premise) +
`docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md` fifth pass (2.1.190–204: no hard break, this was
the one HIGH finding out of 1107 changelog entries). See also [[folder-adoption-import]].

## See also

- [[agent-control-monitor-api]] — the queue (D1) and the command-injection surface reuse this
  gate's idle/subagent safe-state check before firing.
- [[restart-conversation-continuity]] — the other half of the restart path: once this gate lets
  a restart proceed, that page decides whether the relaunch preserves the conversation.

## Notes and lessons learned

[^1]: [id:ATOM-SUBAGENT-COUNTER-ONE-DIRECTION-TRUST, status:valid, keywords:"subagent_counter_untrustworthy_low_direction fail_safe_would_wedge_restart_forever gate_only_on_trusted_direction abandon_dialog_backstop restart_stop_504_times_out", ocd:2026-07-08, lmd:2026-07-08] First instinct was to block whenever the counter
  wasn't provably 0 ("fail safe"). Wrong here: the counter is structurally untrustworthy
  in the LOW direction (plugin#17), so "fail safe" would mean permanently wedging
  stop/restart on data that can never prove safety. When a signal can only be trusted in
  ONE direction, gate only on that direction and put a backstop (the abandon-dialog probe)
  behind the undetectable case.

[^2]: [id:ATOM-REPLACE-NOT-MERGE-STATE-WRITE, status:valid, keywords:"replace_not_merge_destroyed_field_thrice writeState_hook_dropped_fields setActivity_replace_bug spread_prev_key_before_writing keyed_map_partial_object_overwrite", ocd:2026-07-08, lmd:2026-07-08] Replace-not-merge state writes destroyed a field
  THREE independent times in this one saga: the hook's writeState (plugin#17), the WS
  handler's setActivity replace, and nearly the fix itself. Lesson: any per-key state
  update that spreads a NEW object over a keyed map must start from `...prev[key]` unless
  it provably carries every field.
