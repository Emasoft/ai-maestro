---
name: single-active-agent-rendering
description: "why does switching agents lose my terminal scrollback / does ai-maestro mount all agents at once or just one / TerminalView unmounts on agent switch / xterm shows 2 columns after display:none / visibility hidden vs display none for xterm / UI-CRIT-01"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# single-active-agent-rendering

Only the agent whose id matches `activeAgentId` is mounted at any time. Switching agents
unmounts the previous `TerminalView` (and its WebSocket) and mounts a new one. There are NO
"virtual tabs", NO `visibility: hidden` toggling, NO simultaneous mount of every agent.

### The correction (UI-CRIT-01, 2026-05-04)

The earlier version of this section claimed the opposite — describing an aspirational
tab-based architecture that was never implemented. A 2026-05-04 audit (UI-CRIT-01) caught the
drift: the code carried `const isActive = true` and an unreachable `!isActive` branch, while
the docs described a fully different design. The constant + the dead branch have been removed;
this page now matches what the code does.

### Implementation

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

- `TerminalView` unmounts → its `useEffect` cleanup runs → WebSocket closes → tmux pane is
  detached but tmux session keeps running
- xterm scrollback held in JS memory is lost on unmount; the next mount re-attaches and
  re-captures via `tmux capture-pane`
- Agent notes are persisted to localStorage on every keystroke, so a switch does not lose them
- Multi-tab dashboards (multiple browser tabs, one per agent) are the recommended way to keep
  more than one agent live at once

### If you want to revisit the original aspirational design

(mount-all, visibility:hidden, instant switch, no WebSocket churn): it is a real refactor —
terminal init lifecycle, WebSocket connection pooling, the xterm dimension-vs-display gotcha
(`visibility: hidden` keeps layout, `display: none` returns 0×0 — see below). Do not assume
this description is shipped behavior unless you re-verify it. It described a never-shipped
design until 2026-05-04.

### Terminal initialization pattern (current)

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

## Notes and lessons learned
