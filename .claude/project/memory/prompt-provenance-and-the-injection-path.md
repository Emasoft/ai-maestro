---
name: prompt-provenance-and-the-injection-path
description: "fleet recovery keeps deferring / it says a human is present when nobody is at the keyboard / my queued task or nudge stood recovery down / sendCommand always returns 409 Session is not idle even on a fresh session / requireIdle seems to do nothing / why does the CLI pass require_idle=false / how does the server tell an injected prompt from a typed one"
ocd: 2026-08-05
lmd: 2026-09-30
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
publish-globally: false
---

# prompt-provenance-and-the-injection-path

^A7KP2M9X [desc: "The server injects agent prompts via tmux sendKeys with literal:true — the bytes are identical to human typing, so nothing downstream of the pane can distinguish an injected prompt from a typed one.", keywords: how_does_the_server_tell_an_injected_prompt_from_a_typed_one tmux_sendKeys_injection_identical_to_typing injected_prompt_indistinguishable_from_human sendKeys_literal_enter_pane_input who_typed_this_pane_input server_injection_path prompt_injection_detection pane_cannot_distinguish_agent_from_human, ocd: 2026-08-05, lmd: 2026-09-30]
When the server puts text into an agent's pane it uses tmux
`sendKeys(session, text, { literal: true, enter: true })`. Those bytes are **identical to a human's
typing**, so nothing downstream of the pane can tell them apart. That single fact causes both
problems on this page.

## An injected prompt used to report "a human is present" (ai-maestro#117)

^B3RQ8T4C [desc: "ai-maestro#117: the UserPromptSubmit hook POSTs /api/sessions/me/user-input on EVERY prompt and fleet-recovery reads that record as 'a human is present' — one injected prompt stood fleet recovery down for everyone.", keywords: fleet_recovery_keeps_deferring it_says_a_human_is_present_when_nobody_is_typing injected_prompt_stood_recovery_down user_input_route_records_presence fleet_recovery_false_presence presence_record_single_global injected_prompt_defers_recovery ai_maestro_117 system_forged_presence_no_attacker, ocd: 2026-08-05, lmd: 2026-09-30]
Claude Code's `UserPromptSubmit` hook fires for **every** prompt and POSTs
`/api/sessions/me/user-input`, and `fleet-recovery-runner` reads that record as *a human is at the
keyboard, defer*. Presence is a **single global record**, so one injected prompt stood fleet
recovery down for everyone. No attacker needed — the system forged it.

^C9DN5V2K [desc: "The SERVER knows it injected (the hook can't): injectedPrompts Map in services/shared-state.ts — the send sites mark it and the presence route consumes the mark, vetoing that one echo.", keywords: injected_prompt_veto_how_does_it_work injectedPrompts_map_shared_state send_sites_mark_injection presence_route_consumes_mark server_side_veto_injected_echo who_knows_a_prompt_was_injected mark_injection_send_command veto_one_echo_per_mark, ocd: 2026-08-05, lmd: 2026-09-30]
The hook cannot fix this where it runs; it has no way to know. The **server** knows, because it did
the injecting. So `injectedPrompts: Map<sessionName, epochMs>` lives in `services/shared-state.ts`,
the send sites mark it, and the presence route consumes the mark and vetoes that one echo.

^D4XW7H1J [desc: "Three injection surfaces: sendCommand and sendAgentSessionCommand always mark after a successful send; sendChatMessage marks ONLY when the caller is an agent (auth.agentId) — the dashboard chat box is a human really typing.", keywords: which_send_paths_mark_injection sendCommand_sendAgentSessionCommand_always_mark sendChatMessage_caller_conditional auth_agentId_discriminator dashboard_chat_box_human_typing three_injection_surfaces agent_bearer_vs_owner_cookie R42_send_command_self_only, ocd: 2026-08-05, lmd: 2026-09-30]
**Three injection surfaces, and the third is not like the other two:**

| surface | marks |
|---|---|
| `services/sessions-service.ts` `sendCommand` | always, after a successful send |
| `services/agents-core-service.ts` `sendAgentSessionCommand` | always, after a successful send |
| `services/agents-chat-service.ts` `sendChatMessage` | **only when the caller says an agent drove it** |

Chat is caller-conditional because the same function serves the **dashboard's chat box**, where a
human really is typing. The discriminator is `auth.agentId` — set for an agent Bearer, undefined for
the human/system-owner cookie — the same one the veto route uses. R42 makes `send-command`
SELF-ONLY for agents, so when it is an agent the marked pane is the caller's own.

^F2MG6R1W [desc: "Two veto invariants: veto on POSITIVE evidence only (a missing mark never means 'not human' — recovery would race a live user); consume-once, not a time window (one injection = one hook call, mark deleted as it is spent).", keywords: veto_on_positive_evidence_only missing_mark_must_not_mean_not_human recovery_race_live_user consume_once_not_time_window mark_deleted_when_spent injection_veto_invariants absence_of_mark_is_not_absence_of_human age_cap_only_for_undelivered_echo, ocd: 2026-08-05, lmd: 2026-09-30]
**Two invariants that are easy to get backwards:**

- **Veto on POSITIVE evidence only.** No mark ⇒ record presence exactly as before. Inferring
  "not human" from a *missing* mark would make recovery race a live user — the failure the presence
  gate exists to prevent, and strictly worse than the bug it fixes.
- **Consume-once, not a time window.** One injection produces one hook call, so the mark is deleted
  as it is spent. The age cap only discards a mark whose echo never arrived.

^K3NQ7B2V [desc: "Known gaps (both named in the code): the mark is a single scalar per session (loses the second of two injections landing before either echo) and the route guesses the echo pane (online ?? sessions[0]) while marks key the pane actually written.", keywords: injected_mark_known_gaps single_scalar_per_session_loses_second_injection route_guesses_echo_pane online_sessions0_pane_guess hook_lives_in_different_repo two_injections_before_either_echo prompt_hash_session_name_fix, ocd: 2026-08-05, lmd: 2026-09-30]
**Known gaps** (both named in the code): the mark is a single scalar per session, so it loses the
second of two injections landing before either echo arrives; and the route *guesses* which pane the
echo came from (`online ?? sessions[0]`) while the marks key the pane actually written. Both
dissolve only if the hook forwards its own session name plus a hash of the prompt text — and the
hook lives in a different repo.

## The idle gate refuses everything (ai-maestro#110, #51, #60)

^L6WD9P3X [desc: "sendCommand's requireIdle gate can NEVER pass: the activity bump writes Date.now() on the line before the check, so elapsed is ~0 — every call 409s, even the first against a completely fresh session. Pinned by a characterisation test.", keywords: sendCommand_always_returns_409 requireIdle_seems_to_do_nothing idle_gate_never_passes activity_bump_before_idle_check 409_on_fresh_session isSessionIdle_elapsed_zero session_activity_set_then_check require_idle_gate_self_defeating characterisation_test_no_activity, ocd: 2026-08-05, lmd: 2026-09-30]
`sendCommand`'s `requireIdle` defaults to **true**, and the gate **can never pass**:

```
sessionActivity.set(sessionName, Date.now())          // the bump
if (requireIdle && !isSessionIdle(sessionName)) 409    // the check, immediately after
// isSessionIdle:  if (!activity) return true
//                 return (Date.now() - activity) > IDLE_THRESHOLD_MS
```

The bump writes `Date.now()` on the line before the check, so elapsed is ~0 and never exceeds the
threshold; the `!activity` early-out cannot rescue even the first call, because the bump already
wrote the entry. **Every call 409s, including the first against a completely fresh session.** Pinned
by a characterisation test that seeds no activity and asserts the map is empty first.

^M4RB8T2K [desc: "Consequences of the broken idle gate: it protects nothing; the CLI's hardcoded require_idle=false is a WORKAROUND (not an oversight) — using the server default would 409 every injection; wake/freeze-recovery paths must pass requireIdle:false because a frozen agent is never idle.", keywords: require_idle_false_is_a_workaround cli_hardcoded_require_idle make_cli_use_server_default_would_409 wake_or_freeze_recovery_requireIdle_false frozen_agent_never_idle idle_gate_protects_nothing, ocd: 2026-08-05, lmd: 2026-09-30]
Consequences: the "protect a busy agent" gate protects nothing; the CLI's hardcoded
`require_idle=false` is a **workaround**, not an oversight, so "make the CLI use the server default"
would 409 every injection; and any wake or freeze-recovery path must pass `requireIdle: false` — a
frozen agent is by definition never idle.

## Headless mode has no presence route at all

^N7XJ5C3W [desc: "Headless mode has NO presence route: POST /api/sessions/me/user-input exists as a Next route but in none of the headless router's table entries — the hook 404s there, presence never records, the veto is inert. New presence routes must land in BOTH modes.", keywords: headless_mode_no_presence_route user_input_404_in_headless hook_404_headless_presence_never_recorded veto_inert_headless route_added_to_one_side_only_recurring_defect headless_router_explicit_route_table presence_route_both_modes, ocd: 2026-08-05, lmd: 2026-09-30]
`POST /api/sessions/me/user-input` exists as a Next route and in **none** of the headless router's
route-table entries, so the hook 404s there: presence is never recorded and the veto is inert. The
bug is absent in that mode too, but the *feature* is missing. Any new presence route must be added
to **both** modes — the headless router keeps its own explicit table, and a route added to one side
only is a recurring defect here.

## See also

- [[session-control-5-state-model]] — the **UI** status model and the safe-state gate (a different
  subject: that page is about what the badge shows, this one about who typed).
- [[two-server-modes-the-headless-router-reimplements-routes]] — why the two-mode split keeps
  producing this class of gap.

## Notes and lessons learned
