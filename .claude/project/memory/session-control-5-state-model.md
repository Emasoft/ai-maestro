---
name: session-control-5-state-model
description: "agent badge shows the wrong color / what does Waiting vs Idle mean / why is Stop or Restart disabled / how do I approve a permission prompt from the terminal / what is idle_prompt safe state / how does the 5-state agent status model work"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: agents
---

# session-control-5-state-model

Session Control Architecture (v0.27.1+): AI Maestro derives a **5-state agent status model**
from hook notifications and tmux pane detection, and gates all destructive session controls
(Stop, Restart, Approve) on that model reaching a provably safe state.

## The 5-state agent status model

Based on hook notifications and tmux pane detection:

| State | Color | Pulse | Source | Meaning |
|-------|-------|-------|--------|---------|
| Exited | gray-400 | no | `programRunning === false` | Claude process ended, shell prompt visible |
| Permission | orange-500 | yes | `notificationType === 'permission_prompt'` | Claude is blocked waiting for tool approval |
| Waiting | amber-500 | yes | `notificationType === 'idle_prompt'` | Claude finished, waiting for user input (safe state) |
| Active | green-500 | yes | `activityStatus === 'active'` | Claude is processing/generating |
| Idle | green-500 | no | Default when online | Between turns, no recent activity |

## Safe-state gate

All control operations (Stop, Restart, Approve) require `idle_prompt` state — Claude has no
permission prompts pending and is waiting for input.

**Since Claude Code 2.1.198, `idle_prompt` no longer implies "no subagents running"**
(subagents run in the background by default), so the server adds a second gate
(TRDD-O8NCNRWO): stop/restart read the hook's `subagentCount` via
`lib/session-safe-state.ts` and refuse with 409 `subagents_running` when it is provably >0
(`?force=true` overrides; a null/0 counter never blocks because the hook can drop the
counter — see ai-maestro-plugin#17). The restart poll additionally detects `/exit`'s
abandon-confirmation dialog and confirms it rather than timing out blind.

The full mechanics of that second gate — the trust model (only a PROVEN positive counter
blocks, never an absent/null/0 one), the abandon-dialog probe, and the WS state-merge fix
that keeps `subagentCount` from being dropped — live in a dedicated page (see LINKS WANTED
in the migration report; not wired here per the parallel-migration link law).

## Session control buttons (AgentProfile.tsx)

- **Stop** (red): sends 3-command sequence: `C-c` (clear partial input) → `-l '/exit'`
  (literal text) → `Enter`. Enabled only at `idle_prompt`.
- **Restart** (orange): calls `POST /api/sessions/[id]/restart` — sends same 3-command stop
  sequence, polls `tmux display-message` until shell detected (max 15s), waits 1s,
  relaunches with same program args + `--name` persona injection.
- **Approve** (green): sends `y` to terminal. Visible only during `permission_prompt`.

**Auto-restart queue (`useRestartQueue` hook):** After plugin/skill changes, agents are
queued for restart. The queue polls agent activity every 1s (polling chosen over reactive
deps to avoid effect churn from `getSessionActivity` identity changes — SF-044). When a
queued agent reaches `idle_prompt`, it fires the restart API automatically.

## API endpoints

- `POST /api/sessions/[id]/stop` — sends `C-c` + `/exit` + `Enter` to tmux session
- `POST /api/sessions/[id]/restart` — full restart cycle (exit → poll → wait → relaunch)
- `POST /api/sessions/[id]/kill` — immediate tmux kill for non-cooperative agents

## Data flow

Hook (`ai-maestro-hook.cjs`) → state file (`~/.aimaestro/chat-state/`) → WebSocket
broadcast → `useSessionActivity` → `AgentBadge`/`AgentProfile`

## See also

- [[prompt-provenance-and-the-injection-path]] — the other half of "is this agent busy": that page
  covers who TYPED a prompt (the server marks what it injects, so an injected prompt no longer
  reports human presence) and the `sendCommand` idle gate, which is a **server-side** refusal
  distinct from the UI status model here.

## Notes and lessons learned
