---
name: custom-server-and-websocket-pty
description: "why does server.mjs exist / Next.js WebSocket same port / how does the browser terminal connect to tmux / PTY pooling multiple clients one session / WebSocket message protocol input output resize ping pong / session discovery from tmux ls / tmux session name allowed characters / WebSocket reconnection backoff / WebSocket closes when switching agents"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
---

# custom-server-and-websocket-pty

`server.mjs` is a custom Node server that combines Next.js's HTTP handling with a WebSocket
server for terminal streaming, and it is the bridge that turns a browser tab into a live view
of a tmux session running Claude Code. This page covers why it exists, the WebSocket-PTY data
flow, session discovery, the WS message protocol, and the related tmux/session-naming
constraints.

### Custom Server Architecture (server.mjs)

**Why it exists:** Next.js alone doesn't support WebSocket on the same port as HTTP. The custom server combines both.

```
HTTP Requests → Next.js handlers (API routes, pages)
WebSocket Upgrades → Custom WS server (terminal streaming)
Both on port 23000
```

**Key constraint:** The server must handle:
- HTTP/HTTPS for Next.js (pages, API routes)
- WebSocket upgrade requests for `/term?name=<sessionName>`
- Session discovery via `tmux ls` command execution

When modifying `server.mjs`:
- Preserve the upgrade handler that intercepts WebSocket requests
- Maintain the session pooling logic (multiple clients → one PTY)
- Never block the event loop during PTY operations

### Session Discovery Pattern

Sessions are discovered from tmux and LINKED to agents:

```
/api/sessions → Execute `tmux ls` → Parse output → Link to registry agents → Return JSON
```

**Implementation details:**
- Agent metadata is persisted in `~/.aimaestro/agents/registry.json` (file-based registry) and survives dashboard restarts
- Tmux sessions are discovered and LINKED to registry agents — if a registry agent has no running session, it shows as hibernated
- The dashboard CREATES, RENAMES, HIBERNATES, AND DELETES agents via `CreateAgent` / `ChangeName` / `hibernate` / `DeleteAgent` pipelines in `services/element-management-service.ts`
- Session IDs must match tmux session names exactly (alphanumeric + hyphens/underscores only, plus `@` and `.` for `agentId@hostId` multi-host addressing)

When implementing agent-related features:
- Trust the registry as source of truth — it persists across restarts and across tmux crashes
- Handle `tmux ls` returning empty results gracefully (agents may be hibernated)
- Go through the `element-management-service` pipeline for any mutation (creation/deletion/rename/title change/plugin install) — never write directly to the registry

### WebSocket-PTY Bridge

**Critical data flow:**
```
Browser (xterm.js)
  ↕ WebSocket messages (text/binary)
Server (node-pty)
  ↕ PTY (tmux attach-session -t <name>)
tmux session
  ↕ Claude Code CLI
```

**Important constraints:**
- PTY instances are pooled: Multiple WebSocket clients can connect to the same tmux session
- PTY is created on first client connect, destroyed when last client disconnects
- Terminal resize events must be propagated: Browser → WebSocket → PTY → tmux
- Input/output is binary-safe (supports ANSI escape codes, Unicode, etc.)

When working with terminal components:
- xterm.js handles rendering only - it doesn't know about tmux
- WebSocket is the only communication channel (no polling)
- PTY errors (session not found, tmux crashed) must close WebSocket gracefully
- Terminal dimensions (cols/rows) must sync on window resize

### WebSocket message protocol

All WebSocket messages are JSON. Raw terminal output (ANSI codes) is wrapped in
`{ type: 'output', data: ... }`.

```typescript
{ type: 'input', data: string }           // User typed in terminal
{ type: 'output', data: string }          // Terminal output from tmux
{ type: 'resize', cols: number, rows: number }  // Terminal resized
{ type: 'ping' / 'pong' }                 // Heartbeat
{ type: 'error', error: string }          // Protocol error
```

### WebSocket Reconnection Strategy

```typescript
const reconnect = {
  maxAttempts: 5,
  backoff: [100, 500, 1000, 2000, 5000], // Exponential backoff
  strategy: 'exponential'
}
```

After 5 failed reconnection attempts, show error to user. Do NOT retry indefinitely (would waste resources if tmux session truly ended).

### Session Naming Constraints

tmux session names are limited to: `^[a-zA-Z0-9_@.-]+$`

The extended character set (`@` and `.`) supports `agentId@hostId` format used for multi-host agent addressing. **Enforce this** in any UI that creates sessions (Phase 2+). Invalid characters will cause `tmux attach` to fail silently.

### WebSocket Lifecycle vs React Lifecycle

```typescript
useEffect(() => {
  const ws = new WebSocket(url)
  // ... setup handlers ...

  return () => {
    ws.close()  // CRITICAL: Clean up on unmount
  }
}, []) // Empty deps: one socket per MOUNT. The cleanup is not optional — see below.
```

**One socket per MOUNT, and a switch is a mount.** Only the agent matching `activeAgentId` is
rendered, so switching agents unmounts `TerminalView`, runs this cleanup, and **closes the
socket**; the next mount opens a new one. The empty dependency array means "once per mount", not
"once forever" — under single-active rendering those are different things. The tmux session is
unaffected: the pane is detached, not killed, and the next mount re-attaches and re-captures
scrollback. See [[single-active-agent-rendering]].[^1]

### tmux Session Name Parsing

`tmux list-sessions` output format:
```
session-name: 1 windows (created Tue Jan 10 14:23:45 2025)
```

Parsing must handle:
- Session names with hyphens/underscores
- Timestamps in various formats (locale-dependent)
- Multiple windows (number can be > 9)

Use robust regex: `/^([a-zA-Z0-9_@.-]+):/`

## See also

- [[single-active-agent-rendering]] — owns the mount lifecycle this socket's life is tied to: a
  switch is an unmount, which is why the cleanup above runs far more often than "tab architecture"
  implied.
- [[terminal-rendering-and-pty]] — the other half of the same subsystem; what the bytes arriving on
  this socket are rendered by, and the `convertEol` / alternate-screen rules that govern them.

## Notes and lessons learned

[^1]: [id:ATOM-WS-TABARCH, status:valid, keywords:"websocket_persists_across_agent_switch tab_based_architecture_stale terminal_unmounts_on_agent_switch", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT assume the "tab-based architecture (v0.3.0+)" claim (WebSocket persists across agent
    switches, no unmount) describes current behavior, BECAUSE it was superseded by the
    single-active-agent rendering fix (UI-CRIT-01, corrected 2026-05-04) — only the active
    agent's `TerminalView` is ever mounted, so switching agents unmounts the old one and closes
    its WebSocket. DO read [[single-active-agent-rendering]], which owns that correction.
    ROOT CAUSE, and the reason this survived 3 months: UI-CRIT-01 was applied at ONE site (the
    architecture section) while a SECOND site 1200 lines away — a gotcha entry — kept asserting
    the superseded design, in a document too large to read end-to-end. A correction is not done
    until every site that states the old fact is found; `grep` for the CLAIM, not for the section
    you just edited. Corrected 2026-08-02 during the wikimem migration, which is exactly when a
    split would have made the two halves unfindable from each other.
