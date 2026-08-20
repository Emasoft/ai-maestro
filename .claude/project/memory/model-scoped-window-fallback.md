---
name: model-scoped-window-fallback
description: "the Fable window is exhausted but the account still has 5h/7d headroom / why did the rotator evict the whole fleet over ONE model / how do agents get switched off an exhausted model automatically / /model opus does not switch the model / an agent is stuck on a model-switch confirmation dialog / which field says what model an agent is running (none of them do) / the rotator rotated over a model-scoped window / rotated onto an account whose Fable window is also spent / why did the rotator refuse to rotate while an account had headroom / ROTATOR_SCOPED_SWITCH_AT / scoped-only wall"
ocd: 2026-08-06
lmd: 2026-08-20
metadata:
  node_type: memory
  type: project
  tier: component
  topic: reliability-patterns
  globs: [lib/oauth-rotator/model-fallback*.ts, tests/unit/model-fallback*.test.ts]
publish-globally: false
---

# model-scoped-window-fallback

^ATOM-FJIT-3YV9 [desc:"A model-scoped window can be spent while the account is healthy; rotating the credential is the expensive answer to a MODEL limit.", keywords: fable_window_exhausted model_scoped_window account_has_headroom rotator_evicted_the_fleet isSafeAlternate locked_out_123_hours rotating_credential_is_the_expensive_answer, type: project, ocd: 2026-08-06, lmd: 2026-08-06]

Measured 2026-08-06 on the live account: 5h **42%**, 7d **60%**, Fable **~98%**. The rotator
evicted the whole fleet onto alternates at 99% (5h) and 87% (7d) and then refused to return,
because `isSafeAlternate` (`lib/oauth-rotator/tick.ts:349`) disqualifies an account maxed on ANY
window — including one that binds a single MODEL. That is a ~123 h lockout on an account serving
every non-Fable request perfectly, and the owner recovered by hand.

Switching the model is the cheap answer; rotating the credential is the expensive one. The
fallback subsystem does the former. **It routes AROUND `isSafeAlternate`; it does not fix it** —
that fix is a rotation-behaviour change the janitor's `rotator.py` mirrors, so it must land in
both or the two disagree about which account is usable.

^ATOM-APWN-A5H9 [desc:"/model opus raises a confirmation dialog — without the ENTER the agent is left BLOCKED, which is worse than the exhausted window.", keywords: model_opus_does_not_switch_the_model AskUserQuestion_confirmation agent_stuck_on_model_dialog ESC_then_command_then_ENTER confirm_delay, type: project, ocd: 2026-08-06, lmd: 2026-08-06]

`/model opus` does **not** switch the model. Claude Code answers it with an AskUserQuestion and
the switch lands only once that is confirmed with ENTER.

So the sequence is **ESC → `/model opus` → ~3 s settle → ENTER**. ESC first because a pane
mid-render or showing a menu swallows the command as a menu keystroke; the settle because the
dialog must be DRAWN before it can be answered.

A sweep that types the command and walks away does not leave an agent unchanged — it leaves it
**BLOCKED on a dialog, still on the exhausted model**, fleet-wide. That is worse than the state
being repaired, and it is exactly what `block-state` reports as `reason: 'ask_user'`.

Consequence for any implementation: **a failed command must NEVER be confirmed.** No command
landed ⇒ no dialog ⇒ a bare ENTER into a live prompt SUBMITS whatever text sits in it, turning a
failed model switch into the agent being handed an arbitrary instruction.

^ATOM-UGEX-UXUF [desc:"Nothing in the registry or hook state reports an agent's running model — only the pane statusline does.", keywords: which_field_says_what_model_an_agent_is_running Agent.model_is_null no_model_in_chat-state pane_statusline_is_the_only_source parsePaneModel, type: project, ocd: 2026-08-06, lmd: 2026-08-06]

Measured 2026-08-06, all three obvious sources are EMPTY:

| candidate | measured |
|---|---|
| `Agent.model` (`types/agent.ts:207`) | **null for all 13 live agents** |
| `--model` in `programArgs` | absent |
| the hook's chat-state files | **no `model` key — 0 of 419 files** |

A sweep joined on any of them finds nobody, reports "no agents on that model", and does nothing
**forever** — indistinguishable from a healthy fleet.

The only place the running model is observable is the **pane statusline**, which the server
already reads (`capturePane` / `readPaneVerdict`):

    🤖 Sonnet 5 v2.1.223 ·xhigh 🧠 | 📁 frank   | ...
    🤖 Opus 5 (1M) v2.1.223 ·xhigh 🧠 | 📁 testbot | ...

Two traps: the **VERSION** terminates the name, not a space (`Opus 5 (1M)` contains both, so
splitting on the first space truncates every 1M agent), and you must scan from the END —
scrollback holds statuslines naming a model the agent has since left. Join on the FAMILY
(first token, lowercased), never the raw string.

^ATOM-EHU7-1YO2 [desc:"The rotator tick has the window numbers and zero agents; the fleet watchdog has agents and no credential access. They meet at the persisted stamp.", keywords: two_beats_are_disjoint rotator_has_no_agents watchdog_has_no_credential_data persisted_stamp_is_the_join readTickWindows WindowSnapshot, type: project, ocd: 2026-08-06, lmd: 2026-08-06]

`lib/oauth-rotator/tick.ts` has **zero** agent references — it is purely credential-side.
`lib/fleet-liveness-watchdog.ts` has `listAgents`, a 300 s beat, and the actuation stores, and no
credential access. So the subsystem able to ACT could not SEE a model window at all: `fh`, `sd`
and `scWorst` existed only as locals inside `autoRotate`, and the persisted stamp carried
`{nextAction, at, stuck}` with no numbers.

The join is the stamp: `WindowSnapshot` rides the SAME additive out-param `stuck` uses
(`autoRotate` is exported, so widening its return would break every caller), is persisted
validated, and is read back by `readTickWindows` — **stale-gated**, because an hour-old
"Fable 98%" may describe a window that has since reset.

**Do NOT have the watchdog probe usage itself** to avoid the plumbing: that duplicates a
rate-limited request the tick already makes, and two callers would then disagree about the same
window.

^ATOM-74ZX-K1YN [desc:"Pacing needs no persisted plan because the list self-drains — and cooldown is the only per-agent gate, so it is the only refusal worth skipping.", keywords: one_agent_blocks_the_whole_sweep cooldown_stall candidate_list_drains_itself pacing_without_persisting_a_plan ships_dark, type: project, ocd: 2026-08-06, lmd: 2026-08-06]

**The list drains itself.** An agent that switched to Opus no longer reports Fable, so the next
pass re-reads its pane and does not find it. So: switch at most ONE agent per invocation and
re-derive the list every time — no plan to persist, no sleeping the beat, nothing to reconcile
after a crash. Enforce the interval INSIDE the sweep, not by trusting the beat's cadence, and
stamp the clock only on a REAL switch (stamping on a refusal silences it another interval every
pass and it never progresses).

**But do not act on only the FIRST candidate.** A switch that failed to take leaves that agent
still on the exhausted model, still first in the list, holding a per-agent cooldown (10 min) —
during which NO other agent is switched. Invisible on the happy path, which is why it needs a
deliberate guard. Cooldown is the only PER-AGENT gate, so iterate past it and stop dead on every
fleet-wide refusal (fire flag, machine-wide STOP, HID presence).

It **ships dark** (`AIM_FLEET_MODEL_FALLBACK=1`) and that is not caution for its own sake: no test
can prove the confirming ENTER dismissed the dialog — only that the keystroke was SENT. Report the
outcome as three states (confirmed / not / **unknown**) and never collapse unknown into success.

^ATOM-A4DU-OG9O [desc:"the rotator rotated (or refused to) over a model-scoped window — the scoped-only policy the server and the janitor daemon BOTH implement", keywords: scoped_rotation_policy rotator_ignores_model_window ROTATOR_SCOPED_SWITCH_AT ROTATOR_SCOPED_ACCOUNT_HEADROOM scoped-only_wall model-scoped_rotation_trigger janitor_parity one_policy_two_implementations rotated_onto_a_same-model-spent_account healthiest_account_sidelined, ocd: 2026-08-15, lmd: 2026-08-15]

The ROTATION side of a model-scoped wall follows ONE policy with TWO implementations: the
janitor's daemon (`scripts/lib/token_burn.py` + `oauth_rotator/rotator.py`, their v3.3.2
`f185e521`) and this server's `lib/oauth-rotator/tick.ts` (TRDD-IZ6KU37Y, commit `0497a2ba`).
They share the ENV NAMES, not a mapping: `ROTATOR_SCOPED_SWITCH_AT` and
`ROTATOR_SCOPED_ACCOUNT_HEADROOM`, both defaulting to **90**, so one override tunes one policy.

The two rules, and why each is the mirror of a measured incident:

1. **Rotate on a scoped wall, but ONLY onto same-model headroom.** A live account whose model
   window is ≥ 90% while every PROVEN account window is ≤ 90% is walled — even though the
   rotator's own 97% trigger has not tripped. The veto that picks a target is MODEL-IDENTITY
   aware (`scopedVetoPct`): a candidate spent on a model the live account never runs is NOT
   vetoed. The blanket form — any spent scoped window disqualifies an account — is what
   sidelined the fleet's healthiest account for ~123h (janitor#222).
2. **No same-model headroom anywhere ⇒ DO NOT ROTATE.** Not onto a scoped-spent target (the
   `scopedOnly` push is gated by `!scopedWall`), and not degraded either (an explicit stop sits
   before tier 2). Rotation cannot recover a window that is spent on every account; it burns
   the dwell window and a healthy account's runway for nothing. The verdict stays `all-maxed`,
   which is precisely what `stuckSuggestsModelFallback` keys on — so the wall is HANDED to the
   `/model` lane rather than answered with a credential swap.

Every unknown fails OPEN, deliberately and asymmetrically: no live scoped evidence ⇒ nothing
can veto; no PROVEN account window ⇒ never claim a scoped-only wall (acting on unproven
headroom is how "could not measure" silently becomes "measured fine").

`planModelFallback`'s sweep threshold moved 97 → the same shared gate in the same commit. Two
legs tripping at different numbers would leave a DEAD ZONE: an account walled at 92% refused a
rotation (scoped-only) and refused the model switch (below 97), which is the fleet stalling
with both remedies declining to act.


^ATOM-ZFI2-5LWN [desc:"the AskUser auto-answer watchdog leg — answers ask_user menus ONLY, never permission prompts; dark behind AIM_FLEET_ASKUSER_AUTOANSWER=1", keywords: agent_stuck_on_question_menu auto_answer_AskUserQuestion stalled_ask_user_prompt_fleet AIM_FLEET_ASKUSER_AUTOANSWER, ocd: 2026-08-08, lmd: 2026-08-08]

`lib/fleet-askuser-autoanswer.ts` (8e03e32f + 09a97322) is the watchdog leg that answers a
fleet agent's stalled `ask_user` menu with the highlighted default (ENTER). Hard invariants:
it answers ask_user MENUS only and NEVER a `permission` prompt (auto-approving tool permissions
would bypass the permission system); 2-min dwell then RE-VERIFY the pane immediately before
ENTER (a bare ENTER on a dismissed menu submits the prompt text); a menu signature is never
answered twice in 30 min (lockout). Ships DARK behind `AIM_FLEET_ASKUSER_AUTOANSWER=1`
(mirrors `AIM_FLEET_MODEL_FALLBACK`); shares the recovery clock and gates with the
model-fallback leg via `fleet-recovery-actuator`.

## See also

- [[server-oauth-token-continuity-design]] — the credential-side half. That page covers rotation,
  refresh and reauth (what the server does when a TOKEN expires); this one covers what it does
  when a MODEL's window is spent while the token is fine. The two beats are disjoint by design and
  meet only at the persisted tick stamp.

## Notes and lessons learned
