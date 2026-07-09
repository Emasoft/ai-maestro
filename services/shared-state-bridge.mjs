/**
 * Shared State Bridge (ESM) - Thin wrapper for server.mjs to import
 *
 * Uses globalThis to share the same Maps/Sets with the TypeScript version
 * (services/shared-state.ts). This mirrors the pattern used by
 * lib/cerebellum/session-bridge.mjs.
 *
 * server.mjs imports THIS file. API routes (via Next.js) import shared-state.ts.
 * Both reference the same globalThis objects, so state is truly shared.
 *
 * NT-039: SYNC WARNING -- This file intentionally duplicates the logic in
 * services/shared-state.ts because server.mjs is plain ESM and cannot import
 * TypeScript directly. Any changes to broadcastStatusUpdate() or the
 * globalThis._sharedState shape MUST be mirrored in both files.
 */

// Initialize shared maps on globalThis if not already present
if (!globalThis._sharedState) {
  globalThis._sharedState = {
    sessionActivity: new Map(),      // sessionName -> lastActivityTimestamp (ms)
    terminalSessions: new Map(),     // sessionName -> { clients, ptyProcess, logStream, ... }
    statusSubscribers: new Set(),    // Set<WebSocket> for /status subscribers
    companionClients: new Map(),     // agentId -> Set<WebSocket> for /companion-ws
    panelClients: new Map(),         // agentId -> Set<WebSocket> for /panel-ws (TRDD-229CJGYH)
    panelFeedback: new Map(),        // agentId -> [{payload, receivedAt}] awaiting drain
  }
}
// TRDD-229CJGYH back-fill: _sharedState may have been initialized by the OTHER
// side (shared-state.ts, or an older build of either file) WITHOUT the panel
// keys — whichever file loads second must add them or panel state silently
// splits. NT-039 SYNC: mirrored in shared-state.ts.
if (!globalThis._sharedState.panelClients) {
  globalThis._sharedState.panelClients = new Map()
}
if (!globalThis._sharedState.panelFeedback) {
  globalThis._sharedState.panelFeedback = new Map()
}

const state = globalThis._sharedState

export const sessionActivity = state.sessionActivity
export const terminalSessions = state.terminalSessions
export const statusSubscribers = state.statusSubscribers
export const companionClients = state.companionClients
export const panelClients = state.panelClients
export const panelFeedback = state.panelFeedback

// ---------------------------------------------------------------------------
// TRDD-229CJGYH — HTML side-panel fan-out + feedback queue
// NT-039 SYNC: must mirror shared-state.ts
// ---------------------------------------------------------------------------

/**
 * Send a panel WS message (already-shaped object) to every connected /panel-ws
 * client of an agent. Returns how many clients actually received it.
 */
export function broadcastPanelMessage(agentId, message) {
  const clients = panelClients.get(agentId)
  if (!clients || clients.size === 0) return 0

  const payload = JSON.stringify(message)
  let delivered = 0
  const dead = []
  for (const ws of [...clients]) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(payload)
        delivered++
      } catch {
        dead.push(ws)
      }
    } else {
      dead.push(ws)
    }
  }
  for (const ws of dead) clients.delete(ws)
  if (clients.size === 0) panelClients.delete(agentId)
  return delivered
}

// Bound the per-agent feedback queue (feedback is click-scale, not a firehose).
const PANEL_FEEDBACK_MAX = 200

/** Queue one panel→plugin feedback event for later drain (FIFO, bounded). */
export function pushPanelFeedback(agentId, payload) {
  let queue = panelFeedback.get(agentId)
  if (!queue) {
    queue = []
    panelFeedback.set(agentId, queue)
  }
  queue.push({ payload, receivedAt: new Date().toISOString() })
  if (queue.length > PANEL_FEEDBACK_MAX) {
    queue.splice(0, queue.length - PANEL_FEEDBACK_MAX)
  }
}

/** Read-and-clear an agent's queued feedback events (FIFO order). */
export function drainPanelFeedback(agentId) {
  const queue = panelFeedback.get(agentId) ?? []
  panelFeedback.delete(agentId)
  return queue
}

/**
 * Broadcast a status update to all /status WebSocket subscribers.
 * Used by API routes and server.mjs.
 */
// Optional callback invoked after every status broadcast — set by server.mjs for auto-continue
// This avoids duplicating agent-registry logic in this bridge file.
let _onStatusUpdate = null
export function setOnStatusUpdateCallback(fn) {
  _onStatusUpdate = fn
}

export function broadcastStatusUpdate(sessionName, status, hookStatus, notificationType) {
  const message = JSON.stringify({
    type: 'status_update',
    sessionName,
    status,
    hookStatus,
    notificationType,
    timestamp: new Date().toISOString()
  })

  // SF-039: Clean up dead/closed WebSocket subscribers during broadcast
  // to prevent memory leaks from accumulated stale connections.
  // Snapshot the Set to guarantee stable traversal — another async handler
  // (e.g. a WebSocket 'close' event) could mutate statusSubscribers mid-iteration.
  const dead = []
  const snapshot = [...statusSubscribers]
  for (const ws of snapshot) {
    if (ws.readyState === 1) { // WebSocket.OPEN
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

/**
 * Broadcast a governance update to all /status WebSocket subscribers.
 * ISSUE-001: Enables instant UI refresh when governance titles change.
 * NT-039 SYNC: must mirror shared-state.ts
 */
export function broadcastGovernanceUpdate(agentId, newTitle) {
  const message = JSON.stringify({
    type: 'governance_update',
    agentId,
    newTitle,
    timestamp: new Date().toISOString()
  })

  const dead = []
  const snapshot = [...statusSubscribers]
  for (const ws of snapshot) {
    if (ws.readyState === 1) { // WebSocket.OPEN
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
    if (ws.readyState !== 1) statusSubscribers.delete(ws)  // 1 = WebSocket.OPEN
  }
  for (const [agentId, clients] of companionClients) {
    for (const ws of [...clients]) {
      if (ws.readyState !== 1) clients.delete(ws)
    }
    if (clients.size === 0) companionClients.delete(agentId)
  }
  // TRDD-229CJGYH: same pruning for the panel channel. NT-039 SYNC: shared-state.ts
  for (const [agentId, clients] of panelClients) {
    for (const ws of [...clients]) {
      if (ws.readyState !== 1) clients.delete(ws)
    }
    if (clients.size === 0) panelClients.delete(agentId)
  }
}, 30_000)
