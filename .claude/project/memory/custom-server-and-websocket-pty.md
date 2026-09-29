---
name: custom-server-and-websocket-pty
description: "why does server.mjs exist / Next.js WebSocket same port / how does the browser terminal connect to tmux / PTY pooling multiple clients one session / WebSocket message protocol input output resize ping pong / session discovery from tmux ls / tmux session name allowed characters / WebSocket reconnection backoff / WebSocket closes when switching agents"
ocd: 2026-08-02
lmd: 2026-09-28
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: architecture-and-runtime
publish-globally: false
---

# custom-server-and-websocket-pty

`server.mjs` is a custom Node server that combines Next.js's HTTP handling with a WebSocket
server for terminal streaming, and it is the bridge that turns a browser tab into a live view
of a tmux session running Claude Code. This page covers why it exists, the WebSocket-PTY data
flow, session discovery, the WS message protocol, and the related tmux/session-naming
constraints.

### Custom Server Architecture (server.mjs)

^9FCGOH2M [desc: "server.mjs exists because Next.js alone cannot serve WebSocket upgrades on the same port as HTTP; a custom Node server combines Next.js HTTP handling with a WS server for terminal streaming.", keywords: why_does_server.mjs_exist Next.js_websocket_same_port custom_server_architecture port_23000_websocket terminal_streaming_server server.mjs_upgrade_handler what_combines_http_and_websocket handle_http_and_ws_one_port, ocd: 2026-08-02, lmd: 2026-09-28]
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

^V3P3E6XZ [desc: "Sessions come from `tmux ls`, LINKED to registry agents; no running session = hibernated. All agent mutations go through element-management-service pipelines, never direct registry writes.", keywords: session_discovery_from_tmux_ls agent_registry_source_of_truth hibernated_agent_no_session registry.json_survives_restarts how_are_sessions_linked_to_agents CreateAgent_DeleteAgent_pipeline never_write_registry_directly tmux_ls_empty_graceful session_id_must_match_tmux_name element_management_service_pipeline, ocd: 2026-08-02, lmd: 2026-09-28]
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

^PT9JG5VW [desc: "WebSocket-PTY bridge: browser xterm.js ↔ WS ↔ node-pty ↔ `tmux attach-session` ↔ tmux ↔ Claude Code CLI. PTYs are POOLED — multiple WS clients share one PTY, destroyed on last disconnect.", keywords: websocket_pty_bridge_data_flow pty_pooling_multiple_clients_one_session pty_created_first_connect_destroyed_last_disconnect terminal_resize_propagation_browser_to_tmux xterm.js_renders_only_no_tmux binary_safe_ansi_unicode input_output_binary_safe pty_error_closes_websocket_gracefully terminal_dimensions_sync_window_resize tmux_attach_session_node_pty, ocd: 2026-08-02, lmd: 2026-09-28]
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

^GBQS175I [desc: "All WebSocket messages are JSON: input, output (raw ANSI terminal output is WRAPPED in {type:'output',data}), resize {cols,rows}, ping/pong heartbeat, error. Never send raw terminal output unwrapped.", keywords: websocket_message_protocol input_output_resize_ping_pong raw_terminal_output_wrapped_json how_are_ws_messages_formatted websocket_json_message_types terminal_output_type_output_data ws_protocol_json, ocd: 2026-08-02, lmd: 2026-09-28]
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

^799LAMS8 [desc: "WS reconnect: max 5 attempts, exponential backoff [100,500,1000,2000,5000]ms; after 5, show an error. Do NOT retry forever — a truly-ended tmux session would burn resources.", keywords: websocket_reconnection_backoff max_5_reconnect_attempts exponential_backoff_ms reconnect_after_tmux_died when_to_stop_reconnecting_websocket websocket_retry_forever_waste reconnect_strategy_backoff_array, ocd: 2026-08-02, lmd: 2026-09-28]
```typescript
const reconnect = {
  maxAttempts: 5,
  backoff: [100, 500, 1000, 2000, 5000], // Exponential backoff
  strategy: 'exponential'
}
```

After 5 failed reconnection attempts, show error to user. Do NOT retry indefinitely (would waste resources if tmux session truly ended).

### Session Naming Constraints

^L1L4TL7R [desc: "tmux session names are limited to ^[a-zA-Z0-9_@.-]+$ — @ and . support agentId@hostId multi-host addressing. Enforce in any session-creating UI; invalid characters make `tmux attach` fail SILENTLY.", keywords: tmux_session_name_allowed_characters tmux_attach_fails_silently agentId_hostId_format session_name_regex enforce_session_name_ui invalid_characters_tmux_attach session_name_pattern, ocd: 2026-08-02, lmd: 2026-09-28]
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

^T3JGHL8Z [desc: "One WS socket per MOUNT, not per tab: switching agents unmounts TerminalView, cleanup closes the socket, next mount re-attaches — tmux session survives, scrollback re-captured.", keywords: websocket_closes_when_switching_agents one_socket_per_mount effect_cleanup_not_optional empty_deps_means_once_per_mount switching_agents_unmounts_terminal tmux_survives_socket_close scrollback_recaptured_next_mount terminal_view_lifecycle, ocd: 2026-08-02, lmd: 2026-09-28]
**One socket per MOUNT, and a switch is a mount.** Only the agent matching `activeAgentId` is
rendered, so switching agents unmounts `TerminalView`, runs this cleanup, and **closes the
socket**; the next mount opens a new one. The empty dependency array means "once per mount", not
"once forever" — under single-active rendering those are different things. The tmux session is
unaffected: the pane is detached, not killed, and the next mount re-attaches and re-captures
scrollback. See [[single-active-agent-rendering]].[^1]

### tmux Session Name Parsing

^EYDLQCE9 [desc: "`tmux list-sessions` output parsing: names carry hyphens/underscores, locale-dependent timestamps, and window counts > 9; use the robust regex /^([a-zA-Z0-9_@.-]+):/ anchored on the name and colon.", keywords: tmux_list_sessions_output_format tmux_session_name_parsing parse_tmux_ls_output locale_dependent_timestamps multiple_windows_regex robust_session_name_regex, ocd: 2026-08-02, lmd: 2026-09-28]
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
