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

// TRDD-229CJGYH: one feedback event bounced back from pushed panel HTML.
export interface PanelFeedbackEntry {
  payload: unknown
  receivedAt: string
}

declare global {
  // eslint-disable-next-line no-var
  var _sharedState: {
    sessionActivity: Map<string, number>
    injectedPrompts: Map<string, number>
    terminalSessions: Map<string, PTYSessionState>
    statusSubscribers: Set<WebSocket>
    companionClients: Map<string, Set<WebSocket>>
    panelClients?: Map<string, Set<WebSocket>>
    panelFeedback?: Map<string, PanelFeedbackEntry[]>
  } | undefined
}

if (!globalThis._sharedState) {
  globalThis._sharedState = {
    sessionActivity: new Map<string, number>(),
    injectedPrompts: new Map<string, number>(),
    terminalSessions: new Map<string, PTYSessionState>(),
    statusSubscribers: new Set<WebSocket>(),
    companionClients: new Map<string, Set<WebSocket>>(),
    panelClients: new Map<string, Set<WebSocket>>(),
    panelFeedback: new Map<string, PanelFeedbackEntry[]>(),
  }
}
// TRDD-229CJGYH back-fill: _sharedState may have been initialized by the OTHER
// side (shared-state-bridge.mjs, or an older build of either file) WITHOUT the
// panel keys — the `if (!globalThis._sharedState)` guard above then skips them.
// Whichever file loads second must add the missing keys, or panel state would
// silently split. Mirrored in shared-state-bridge.mjs (NT-039).
if (!globalThis._sharedState.panelClients) {
  globalThis._sharedState.panelClients = new Map<string, Set<WebSocket>>()
}
if (!globalThis._sharedState.panelFeedback) {
  globalThis._sharedState.panelFeedback = new Map<string, PanelFeedbackEntry[]>()
}
// ai-maestro#117 back-fill — the SAME failure the panel back-fill above exists for, and it was
// missed when `injectedPrompts` was added (2026-08-06): in FULL mode the bridge
// (shared-state-bridge.mjs) initializes `_sharedState` FIRST, so `state.injectedPrompts` was
// `undefined` here and every `sendAgentSessionCommand` threw on `.set` — 13 days of 500s on
// every server-side inject (pm2-error.log 2026-08-06 14:16 → 2026-08-19 19:48). Any NEW key on
// `_sharedState` needs a back-fill in BOTH files, not a slot in one initializer. NT-039 SYNC.
if (!globalThis._sharedState.injectedPrompts) {
  globalThis._sharedState.injectedPrompts = new Map<string, number>()
}

const state = globalThis._sharedState

// ---------------------------------------------------------------------------
// Exports — all backed by globalThis._sharedState
// ---------------------------------------------------------------------------

/** sessionName -> last activity timestamp (ms). Populated by server.mjs PTY data handler. */
export const sessionActivity: Map<string, number> = state.sessionActivity

/**
 * sessionName -> epoch ms of the last prompt THE SERVER ITSELF injected into that pane.
 *
 * WHY THIS EXISTS (ai-maestro#117). Injection is literal keystrokes
 * (`sendKeys(…, {literal:true})`), so Claude Code's `UserPromptSubmit` hook cannot tell an
 * injected prompt from a typed one — and that hook is what POSTs
 * `/api/sessions/me/user-input`, the record `fleet-recovery-runner` reads as "a human is at
 * the keyboard, defer". Result: every queued task, nudge or self-trigger silently reported
 * human presence and stood recovery down. No attacker required; the system forged it.
 *
 * The hook cannot be fixed where it runs — it has no way to know. The SERVER does know,
 * because it did the injecting, so the knowledge lives here and the route consults it.
 *
 * DIRECTION MATTERS, and it is the whole design: this is a **veto on positive evidence**,
 * never an inference from absence. A missing entry means "we did not inject" ⇒ record
 * presence exactly as before. Only a matching entry suppresses one record. Inverting that —
 * treating no-entry as "not human" — would make recovery race a live user, which is the
 * failure the presence gate exists to prevent and is strictly worse than what we had.
 *
 * THREE writers, and the third is not like the other two. `sessions-service.sendCommand` and
 * `agents-core-service.sendAgentSessionCommand` mark unconditionally after a successful send.
 * `agents-chat-service.sendChatMessage` marks only when its caller says an AGENT drove the call,
 * because that same function also serves the dashboard's chat box — a human genuinely typing.
 *
 * DO NOT ADD a `lastPromptOrigin`-style "last verdict per session" map beside this one.
 * It was designed and REJECTED (advisor review, 2026-08-05): a non-consuming "last per session"
 * value re-creates the very race it claims to remove — between a consumer's write and its read a
 * second prompt overwrites it, so the reader gets a confident answer about the wrong prompt. The
 * per-request verdict already travels synchronously in the POST response body of
 * `/api/sessions/me/user-input`, which is strictly better because it cannot be overwritten. If a
 * second consumer ever appears that genuinely cannot see that response, key verdicts by PROMPT
 * IDENTITY (session + a hash of the prompt text the hook forwards), never by "last".
 *
 * KNOWN GAPS, both real and both out of scope here — see ai-maestro#117:
 *   - HEADLESS MODE has no `/api/sessions/me/user-input` route at all (0 of the headless router's
 *     251 route entries match it), so the hook 404s, presence is never recorded, and the veto is
 *     inert there. The bug it fixes is also absent there, but the presence FEATURE is missing.
 *   - A SINGLE SCALAR per session loses the second of two injections that land before either echo
 *     arrives, and the route GUESSES which pane the echo came from (`online ?? sessions[0]`) while
 *     the marks key the pane actually written. Both are fixed structurally by the prompt-identity
 *     protocol above, which needs the hook (a different repo) to start forwarding its own session
 *     name and prompt hash.
 */
export const injectedPrompts: Map<string, number> = state.injectedPrompts

/** sessionName -> PTY process + connected clients. Populated by server.mjs WebSocket handler. */
export const terminalSessions: Map<string, PTYSessionState> = state.terminalSessions

/** Connected /status WebSocket clients. */
export const statusSubscribers: Set<WebSocket> = state.statusSubscribers

/** agentId -> connected /companion-ws clients. */
export const companionClients: Map<string, Set<WebSocket>> = state.companionClients

/** agentId -> connected /panel-ws clients (TRDD-229CJGYH HTML side panel). */
export const panelClients: Map<string, Set<WebSocket>> = state.panelClients!

/** agentId -> queued panel feedback events awaiting drain (TRDD-229CJGYH). */
export const panelFeedback: Map<string, PanelFeedbackEntry[]> = state.panelFeedback!

// ---------------------------------------------------------------------------
// TRDD-229CJGYH — HTML side-panel fan-out + feedback queue
// NT-039 SYNC: must mirror shared-state-bridge.mjs
// ---------------------------------------------------------------------------

/**
 * Send a panel WS message (already-shaped object) to every connected /panel-ws
 * client of an agent. Returns how many clients actually received it — 0 tells
 * the API caller no dashboard has the panel channel open right now.
 */
export function broadcastPanelMessage(agentId: string, message: object): number {
  const clients = panelClients.get(agentId)
  if (!clients || clients.size === 0) return 0

  const payload = JSON.stringify(message)
  let delivered = 0
  const dead: WebSocket[] = []
  for (const ws of [...clients]) {
    if (ws.readyState === WS_OPEN) {
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

// Bound the per-agent feedback queue: feedback is click-scale (not a firehose),
// so 200 undrained events means the consumer is gone — drop the oldest rather
// than grow without bound.
const PANEL_FEEDBACK_MAX = 200

/** Queue one panel→plugin feedback event for later drain (FIFO, bounded). */
export function pushPanelFeedback(agentId: string, payload: unknown): void {
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
export function drainPanelFeedback(agentId: string): PanelFeedbackEntry[] {
  const queue = panelFeedback.get(agentId) ?? []
  panelFeedback.delete(agentId)
  return queue
}

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
  // TRDD-229CJGYH: same pruning for the panel channel.
  for (const [agentId, clients] of panelClients) {
    for (const ws of [...clients]) {
      if (ws.readyState !== WS_OPEN) clients.delete(ws)
    }
    if (clients.size === 0) panelClients.delete(agentId)
  }
}, 30_000)
