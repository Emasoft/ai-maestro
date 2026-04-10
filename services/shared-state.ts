/**
 * Shared State Module (TypeScript)
 *
 * Replaces the 5 global.* bridges between server.mjs and API routes.
 *
 * Uses globalThis._sharedState so the same Maps/Sets are shared between:
 *   - server.mjs (imports shared-state-bridge.mjs)
 *   - API routes  (import this file via @/services/shared-state)
 *
 * Both sides reference the same globalThis objects.
 */

import type WebSocket from 'ws'

// NT-020: Named constant for WebSocket readyState (type-only import prevents WebSocket.OPEN)
const WS_OPEN = 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PTYSessionState {
  clients: Set<WebSocket>
  ptyProcess: any  // node-pty IPty
  logStream?: any
  lastActivity?: number
  cleanupTimer?: ReturnType<typeof setTimeout>
}

export interface StatusUpdate {
  type: 'status_update'
  sessionName: string
  status: string
  hookStatus?: string
  notificationType?: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Shared globalThis initialization
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var _sharedState: {
    sessionActivity: Map<string, number>
    terminalSessions: Map<string, PTYSessionState>
    statusSubscribers: Set<WebSocket>
    companionClients: Map<string, Set<WebSocket>>
  } | undefined
}

if (!globalThis._sharedState) {
  globalThis._sharedState = {
    sessionActivity: new Map<string, number>(),
    terminalSessions: new Map<string, PTYSessionState>(),
    statusSubscribers: new Set<WebSocket>(),
    companionClients: new Map<string, Set<WebSocket>>(),
  }
}

const state = globalThis._sharedState

// ---------------------------------------------------------------------------
// Exports — all backed by globalThis._sharedState
// ---------------------------------------------------------------------------

/** sessionName -> last activity timestamp (ms). Populated by server.mjs PTY data handler. */
export const sessionActivity: Map<string, number> = state.sessionActivity

/** sessionName -> PTY process + connected clients. Populated by server.mjs WebSocket handler. */
export const terminalSessions: Map<string, PTYSessionState> = state.terminalSessions

/** Connected /status WebSocket clients. */
export const statusSubscribers: Set<WebSocket> = state.statusSubscribers

/** agentId -> connected /companion-ws clients. */
export const companionClients: Map<string, Set<WebSocket>> = state.companionClients

// ---------------------------------------------------------------------------
// Broadcast a status update to all /status WebSocket subscribers
// ---------------------------------------------------------------------------

// Optional callback invoked after every status broadcast — set by server.mjs for auto-continue
// NT-039 SYNC: must mirror shared-state-bridge.mjs
type OnStatusUpdateCallback = (sessionName: string, status: string, hookStatus?: string, notificationType?: string) => void
let _onStatusUpdate: OnStatusUpdateCallback | null = null
export function setOnStatusUpdateCallback(fn: OnStatusUpdateCallback): void {
  _onStatusUpdate = fn
}

export function broadcastStatusUpdate(
  sessionName: string,
  status: string,
  hookStatus?: string,
  notificationType?: string
): void {
  const message = JSON.stringify({
    type: 'status_update',
    sessionName,
    status,
    hookStatus,
    notificationType,
    timestamp: new Date().toISOString()
  } satisfies StatusUpdate)

  // SF-039: Clean up dead/closed WebSocket subscribers during broadcast
  // to prevent memory leaks from accumulated stale connections.
  // Snapshot the Set to guarantee stable traversal — another async handler
  // (e.g. a WebSocket 'close' event) could mutate statusSubscribers mid-iteration.
  const dead: WebSocket[] = []
  const snapshot = [...statusSubscribers]
  for (const ws of snapshot) {
    // NT-020: Use named constant instead of magic number for WebSocket.OPEN
    if (ws.readyState === WS_OPEN) {
      try { ws.send(message) } catch { dead.push(ws) }
    } else {
      dead.push(ws)
    }
  }
  for (const ws of dead) {
    statusSubscribers.delete(ws)
  }

  // Notify auto-continue system of status changes
  if (_onStatusUpdate) {
    _onStatusUpdate(sessionName, status, hookStatus, notificationType)
  }
}

// ---------------------------------------------------------------------------
// Broadcast a governance update to all /status WebSocket subscribers
// ISSUE-001: Enables instant UI refresh when governance titles change
// NT-039 SYNC: must mirror shared-state-bridge.mjs
// ---------------------------------------------------------------------------

export function broadcastGovernanceUpdate(
  agentId: string,
  newTitle: string | null,
): void {
  const message = JSON.stringify({
    type: 'governance_update',
    agentId,
    newTitle,
    timestamp: new Date().toISOString()
  })

  const dead: WebSocket[] = []
  const snapshot = [...statusSubscribers]
  for (const ws of snapshot) {
    if (ws.readyState === WS_OPEN) {
      try { ws.send(message) } catch { dead.push(ws) }
    } else {
      dead.push(ws)
    }
  }
  for (const ws of dead) {
    statusSubscribers.delete(ws)
  }
}

// ---------------------------------------------------------------------------
// Broadcast an agent data update to all /status WebSocket subscribers.
// Fired by Change* AIO functions (avatar, name, folder, etc.) so that
// ALL connected UI components refresh instantly without waiting for polling.
// ---------------------------------------------------------------------------

export function broadcastAgentUpdate(
  agentId: string,
  fields: string[],
): void {
  const message = JSON.stringify({
    type: 'agent_data_update',
    agentId,
    fields,
    timestamp: new Date().toISOString()
  })

  const dead: WebSocket[] = []
  const snapshot = [...statusSubscribers]
  for (const ws of snapshot) {
    if (ws.readyState === WS_OPEN) {
      try { ws.send(message) } catch { dead.push(ws) }
    } else {
      dead.push(ws)
    }
  }
  for (const ws of dead) {
    statusSubscribers.delete(ws)
  }
}

// ---------------------------------------------------------------------------
// SF-039b: Proactive dead WebSocket cleanup every 30s
// During idle periods without broadcasts, closed WebSockets added by the
// subscription handler would leak memory indefinitely. This interval
// ensures stale connections are pruned even when no broadcasts occur.
// ---------------------------------------------------------------------------
setInterval(() => {
  for (const ws of [...statusSubscribers]) {
    if (ws.readyState !== WS_OPEN) statusSubscribers.delete(ws)
  }
  for (const [agentId, clients] of companionClients) {
    for (const ws of [...clients]) {
      if (ws.readyState !== WS_OPEN) clients.delete(ws)
    }
    if (clients.size === 0) companionClients.delete(agentId)
  }
}, 30_000)
