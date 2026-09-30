---
name: single-active-agent-rendering
description: "why does switching agents lose my terminal scrollback / does ai-maestro mount all agents at once or just one / TerminalView unmounts on agent switch / xterm shows 2 columns after display:none / visibility hidden vs display none for xterm / UI-CRIT-01"
ocd: 2026-08-02
lmd: 2026-09-30
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
publish-globally: false
---

# single-active-agent-rendering

^X2DR8P6L [desc: "Only the agent whose id matches activeAgentId is mounted at any time; switching agents unmounts the previous TerminalView (and its WebSocket) and mounts a new one — NO virtual tabs, NO visibility:hidden toggling, NO simultaneous mount of every agent.", keywords: does_ai_maestro_mount_all_agents_at_once_or_just_one switching_agents_unmounts_terminalview only_active_agent_is_mounted no_virtual_tabs no_visibility_hidden_toggling mount_model_activeAgentId WebSocket_closes_on_agent_switch, ocd: 2026-08-02, lmd: 2026-09-30]
Only the agent whose id matches `activeAgentId` is mounted at any time. Switching agents
unmounts the previous `TerminalView` (and its WebSocket) and mounts a new one. There are NO
"virtual tabs", NO `visibility: hidden` toggling, NO simultaneous mount of every agent.

### The correction (UI-CRIT-01, 2026-05-04)

^Y5GN3T8C [desc: "UI-CRIT-01 (2026-05-04): an earlier version of this page described an aspirational tab-based mount-all architecture that was NEVER implemented — the code carried const isActive = true and an unreachable !isActive branch. The dead code was removed; the page now matches the code.", keywords: UI_CRIT_01_docs_described_unshipped_design aspirational_tab_based_architecture_never_implemented const_isActive_true_unreachable_branch docs_drifted_from_code removed_dead_isActive_branch page_matches_what_code_does, ocd: 2026-08-02, lmd: 2026-09-30]
The earlier version of this section claimed the opposite — describing an aspirational
tab-based architecture that was never implemented. A 2026-05-04 audit (UI-CRIT-01) caught the
drift: the code carried `const isActive = true` and an unreachable `!isActive` branch, while
the docs described a fully different design. The constant + the dead branch have been removed;
this page now matches what the code does.

### Implementation

^Z7BW6K2M [desc: "Implementation (app/page.tsx): only the active agent renders — selectableAgents.find(a => a.id === activeAgentId), a keyed div (key={agent.id}), and activeTab switches between TerminalView, AgentChat, etc.", keywords: app_page_tsx_active_agent_render selectableAgents_find_activeAgentId key_agent_id_remount activeTab_terminal_or_chat TerminalView_session_mapping implementation_snippet_single_active, ocd: 2026-08-02, lmd: 2026-09-30]
```tsx
// app/page.tsx — only the active agent is rendered
const agent = selectableAgents.find(a => a.id === activeAgentId)
if (!agent) return null
return (
  <div key={agent.id} className="absolute inset-0 flex flex-col">
    {/* tab bar (terminal/chat/messages/worktree/search/export/profile) */}
    {activeTab === 'terminal' ? (
      <TerminalView session={agentToSession(agent)} isVisible={activeTab === 'terminal'} />
    ) : activeTab === 'chat' ? (
      <AgentChat ... />
    ) : ...}
  </div>
)
```

### Consequences (state on switch)

^3XJ9R4VD [desc: "State on switch: TerminalView unmounts → its useEffect cleanup closes the WebSocket; the tmux pane detaches but the tmux SESSION keeps running; xterm scrollback held in JS memory is lost (next mount re-captures via tmux capture-pane); agent notes persist to localStorage on every keystroke.", keywords: why_does_switching_agents_lose_my_terminal_scrollback terminalview_unmount_closes_websocket tmux_pane_detached_session_keeps_running xterm_scrollback_lost_on_unmount recapture_via_tmux_capture_pane agent_notes_persist_localstorage multi_tab_dashboards_recommended_for_multiple_live_agents, ocd: 2026-08-02, lmd: 2026-09-30]
- `TerminalView` unmounts → its `useEffect` cleanup runs → WebSocket closes → tmux pane is
  detached but tmux session keeps running
- xterm scrollback held in JS memory is lost on unmount; the next mount re-attaches and
  re-captures via `tmux capture-pane`
- Agent notes are persisted to localStorage on every keystroke, so a switch does not lose them
- Multi-tab dashboards (multiple browser tabs, one per agent) are the recommended way to keep
  more than one agent live at once

### If you want to revisit the original aspirational design

^5KP8H2QN [desc: "The aspirational design (mount-all, visibility:hidden, instant switch, no WebSocket churn) is a real refactor — terminal init lifecycle, WebSocket pooling, the xterm dimension-vs-display gotcha. Do not assume it is shipped behavior without re-verification.", keywords: revisit_original_aspirational_design mount_all_visibility_hidden_instant_switch real_refactor_not_shipped websocket_connection_pooling never_shipped_design_do_not_assume, ocd: 2026-08-02, lmd: 2026-09-30]
(mount-all, visibility:hidden, instant switch, no WebSocket churn): it is a real refactor —
terminal init lifecycle, WebSocket connection pooling, the xterm dimension-vs-display gotcha
(`visibility: hidden` keeps layout, `display: none` returns 0×0 — see below). Do not assume
this description is shipped behavior unless you re-verify it. It described a never-shipped
design until 2026-05-04.

### Terminal initialization pattern (current)

^6MW4T7ZB [desc: "TerminalView initializes on EVERY mount and disposes on every unmount (empty deps array): with single-active rendering, fresh-mount-on-every-switch IS the lifecycle — the empty deps array does not make initialization happen-once-forever.", keywords: terminal_initialization_pattern_empty_deps effect_runs_on_every_fresh_mount cleanup_runs_when_switched_away empty_deps_not_happen_once_forever initializeTerminal_containerElement key_agent_id_instance_lifecycle, ocd: 2026-08-02, lmd: 2026-09-30]
```typescript
// components/TerminalView.tsx — initializes on every mount,
// disposes on every unmount.
useEffect(() => {
  let cleanup: (() => void) | undefined
  const init = async () => {
    cleanup = await initializeTerminal(containerElement)
    setIsReady(true)
  }
  init()
  return () => { if (cleanup) cleanup() }
}, [])
```

The empty dependency array makes the effect run on every fresh mount (once per `key={agent.id}`
instance), and the cleanup runs when the agent is switched away. With single-active rendering,
"fresh mount on every switch" IS the lifecycle — the empty deps array does not magically make
initialization happen-once-forever.

### xterm dimension gotcha — `display: none` returns 0×0

^8TJ3C6QN [desc: "xterm gotcha (future relevance — matters only for a mount-all design): inactive terminals MUST use visibility:hidden, not display:none — display:none removes the element from layout so getBoundingClientRect returns 0×0 and xterm initializes with 2 columns; pair with pointerEvents:none.", keywords: xterm_shows_2_columns_after_display_none visibility_hidden_vs_display_none_for_xterm getBoundingClientRect_zero_dimensions_xterm inactive_terminal_visibility_hidden pointerEvents_none_hidden_tabs xterm_minimum_columns_2, ocd: 2026-08-02, lmd: 2026-09-30]
**Future relevance only.** AI Maestro currently renders only the active agent (see above). This
gotcha matters the day someone implements the multi-agent mount design — at which point
inactive terminals MUST use `visibility: hidden` rather than `display: none`:

- `display: none` removes element from layout → `getBoundingClientRect()` returns
  width/height = 0 → xterm initializes with minimum columns (2)
- `visibility: hidden` keeps element in layout → correct dimensions
- Pair with `pointerEvents: none` to prevent hidden tabs from stealing mouse events while
  keeping the layout intact

If you find yourself writing this pattern, also re-read the rest of this page — the codebase
(WebSocket lifecycle, init effects with empty deps) assumes single-mount semantics, and a switch
to mount-all needs coordinated changes.

## See also

- [[custom-server-and-websocket-pty]] — the socket whose lifetime this mount model decides. Its
  gotcha section asserted the opposite ("WebSocket persists across agent switches") until
  2026-08-02, because UI-CRIT-01 was applied here and not there.
- [[dashboard-ui-patterns]] — the surrounding state model; "active agent id" selects what is
  MOUNTED, it is not a visibility toggle.

## Notes and lessons learned
