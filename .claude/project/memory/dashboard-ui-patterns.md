---
name: dashboard-ui-patterns
description: "how are agent category colors assigned in the sidebar / why no Redux or Zustand in ai-maestro / where do agent notes get saved / nested button React hydration error / which hooks manage terminal and websocket lifecycle / Skills Explorer vs Plugins Explorer settings tabs / 3-level agent hierarchy naming"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# dashboard-ui-patterns

Covers the deliberately-minimal React state management, the hierarchical agent organization,
the dynamic color/icon system, agent notes, agent management actions, the Settings page tabs,
UI best practices, and the TypeScript type-system domain separation used across the dashboard.

## React State Management Pattern

**Deliberately minimal:** No Redux, Zustand, or complex state libraries.

```
App State:
- Active agent ID (localStorage persistence; decides which single agent is MOUNTED — **not** a
  visibility toggle, see [[single-active-agent-rendering]])
- Agent list (fetched from /api/sessions every 10s)
- WebSocket connection state (per agent, persistent)

Component State:
- Terminal instance (xterm.js, created once per MOUNT — i.e. re-created on every agent switch)[^1]
- Connection errors (transient, cleared on retry)
- Agent notes (loaded once, persist in component state)
```

**Key hooks:**
- `useSessions()` - Fetches session list, auto-refreshes
- `useTerminal()` - Manages xterm.js lifecycle (init once, resize, dispose)
- `useWebSocket()` - Handles WebSocket connection, reconnection, message routing
- `useActiveSession()` - Tracks selected agent with localStorage

When adding new state:
- Keep it in the nearest component that needs it
- Use Context only if 3+ components need the same state
- Never store terminal content in React state (xterm.js manages this)
- Consider if state needs to persist across agent switches (keep in component) vs. reload (use effect with session.id dependency)

## UI Enhancement Patterns

**Hierarchical Agent Organization:**

Agents are organized in a 3-level hierarchy based on their names:
```
fluidmind/agents/backend-architect  →  Level 1: "fluidmind"
                                        Level 2: "agents"
                                        Agent: "backend-architect"
```

**Dynamic Color System:**
- Colors assigned via hash function (same category = same color)
- 8-color palette in `AgentList.tsx` (easily customizable)
- Supports localStorage overrides per category
- No hardcoded category names - works with ANY category

```typescript
const getCategoryColor = (category: string) => {
  // Hash-based color assignment from COLOR_PALETTE
  const hash = category.split('').reduce((acc, char) =>
    char.charCodeAt(0) + ((acc << 5) - acc), 0)
  const colorIndex = Math.abs(hash) % COLOR_PALETTE.length
  return COLOR_PALETTE[colorIndex]
}
```

**Icon System:**
- Uses lucide-react for consistent, accessible icons
- Default icon: `Layers` (can be customized per category)
- Icons for: folders, terminals, actions (edit, delete, create)

**Agent Notes Feature:**
- Collapsible textarea below terminal for per-agent notes
- Auto-saves to localStorage (`session-notes-${sessionId}`)
- Collapse state persisted (`session-notes-collapsed-${sessionId}`)
- Full copy/paste/edit support

**Agent Management:**
- Rename agents with validation (API call to backend)
- Delete agents with confirmation modal
- Create new agents with optional working directory
- All actions update UI optimistically with error handling

**Settings Page (`/settings`):**
- Sidebar labels: Hosts, Domains, Webhooks, Skills Explorer, Plugins Explorer, Experiments, Onboarding, Help, About
- "Skills Explorer" (`marketplace` tab) — marketplace skill browser for agent installation
- "Plugins Explorer" (`global-elements` tab) — plugin toggles, element listing, marketplace management

**UI Best Practices:**
- Avoid nested buttons (causes React hydration errors)
- Use `<div>` with `cursor-pointer` for clickable containers
- Always use `e.stopPropagation()` for nested interactive elements
- Keep hover states smooth with `transition-all duration-200`

## TypeScript Type System Organization

**Strict separation by domain:**

```
types/session.ts    - Session metadata, status enums
types/terminal.ts   - xterm.js configuration, dimensions
types/websocket.ts  - Message protocol, connection states
```

**WebSocket message protocol:**
```typescript
{ type: 'input', data: string }           // User typed in terminal
{ type: 'output', data: string }          // Terminal output from tmux
{ type: 'resize', cols: number, rows: number }  // Terminal resized
{ type: 'ping' / 'pong' }                 // Heartbeat
{ type: 'error', error: string }          // Protocol error
```

All WebSocket messages are JSON. Raw terminal output (ANSI codes) is wrapped in `{ type: 'output', data: ... }`.

## See also

## Notes and lessons learned

[^1]: [id:ATOM-UI-VISTOGGLE, status:valid, keywords:"active_agent_id_visibility_toggle mount_all_agents_hidden inactive_agents_stay_mounted", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT read "active agent id drives a visibility toggle" as meaning inactive agents stay
    mounted and hidden, BECAUSE that phrasing is a leftover of the mount-all design that was never
    implemented — the id selects the ONE agent that is rendered at all. DO see
    [[single-active-agent-rendering]]. ROOT CAUSE: the UI-CRIT-01 correction (2026-05-04) was
    applied to the architecture section and to no other site, so THREE further sentences across
    CLAUDE.md kept asserting the superseded design. Corrected 2026-08-02, at migration time,
    because splitting the file would have put the contradicting halves in different pages where
    neither reader could see the other.
