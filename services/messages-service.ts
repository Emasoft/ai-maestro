/**
 * Messages & Meetings Service
 *
 * Pure business logic extracted from app/api/messages/** and app/api/meetings/** routes.
 * No HTTP concepts (Request, Response, NextResponse, headers) leak into this module.
 * API routes become thin wrappers that call these functions.
 *
 * Covers:
 *   GET    /api/messages                 -> getMessages
 *   POST   /api/messages                 -> sendMessage
 *   PATCH  /api/messages                 -> updateMessage
 *   DELETE /api/messages                 -> removeMessage
 *   POST   /api/messages/forward         -> forwardMessage
 *   GET    /api/messages/meeting         -> getMeetingMessages
 *   GET    /api/meetings                 -> listMeetings
 *   POST   /api/meetings                 -> createNewMeeting
 *   GET    /api/meetings/[id]            -> getMeetingById
 *   PATCH  /api/meetings/[id]            -> updateExistingMeeting
 *   DELETE /api/meetings/[id]            -> deleteExistingMeeting
 */

import {
  listInboxMessages,
  listSentMessages,
  getSentCount,
  getMessage,
  markMessageAsRead,
  archiveMessage,
  deleteMessage,
  getUnreadCount,
  getMessageStats,
  listAgentsWithMessages,
  resolveAgentIdentifier,
} from '@/lib/messageQueue'
import type { MessageSummary } from '@/lib/messageQueue'
import { sendFromUI } from '@/lib/message-send'
import { forwardFromUI } from '@/lib/message-send'
import { searchAgents } from '@/lib/agent-registry'
import { getSelfHostId, getSelfHost } from '@/lib/hosts-config'
import {
  loadMeetings,
  createMeeting,
  getMeeting,
  updateMeeting,
  deleteMeeting,
} from '@/lib/meeting-registry'
import type { SidebarMode } from '@/types/team'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { ServiceResult } from '@/types/service'
import type { AuthContext } from '@/lib/agent-auth'
// ServiceResult imported directly from canonical source

// ---------------------------------------------------------------------------
// Per-mailbox ownership guard (defence-in-depth)
// ---------------------------------------------------------------------------

/**
 * Service-layer object-level authz for the global message routes.
 *
 * The route handlers already override the `agent` param with the verified
 * caller identity (the primary IDOR closure). This guard is defence-in-depth:
 * if a future caller forwards an `authContext` but forgets the route-level
 * override, the service still refuses to read/mutate a mailbox the caller
 * does not own. It mirrors SendMessage's G04.AUTH reject (R28/R32/R38 — an
 * AID+title ownership check, never a sudo gate).
 *
 * - `authContext` undefined  → no enforcement (internal / headless callers
 *   that don't carry a verified identity; the route guard is authoritative).
 * - `isSystemOwner`          → exempt (web UI may touch any mailbox).
 * - authenticated agent      → the supplied identifier must resolve to the
 *   caller's own agentId, else 403.
 *
 * Returns a `ServiceResult` error envelope on denial, or null when allowed.
 */
function denyForeignMailbox(
  agentIdentifier: string | null | undefined,
  authContext?: AuthContext,
): ServiceResult<never> | null {
  if (!authContext || authContext.isSystemOwner) return null
  // An authenticated agent without a resolvable own-identity cannot own any
  // mailbox — refuse rather than fall through.
  if (!authContext.agentId) {
    return { error: 'Forbidden — you may only access your own mailbox', status: 403 }
  }
  if (!agentIdentifier) {
    return { error: 'Forbidden — you may only access your own mailbox', status: 403 }
  }
  const resolved = resolveAgentIdentifier(agentIdentifier)
  if (!resolved || resolved.agentId !== authContext.agentId) {
    return { error: 'Forbidden — you may only access your own mailbox', status: 403 }
  }
  return null
}

// ---------------------------------------------------------------------------
// Messages: GET /api/messages
// ---------------------------------------------------------------------------

export interface GetMessagesParams {
  agent?: string | null
  id?: string | null
  action?: string | null
  box?: string | null
  limit?: string | null
  status?: string | null
  priority?: string | null
  from?: string | null
  to?: string | null
}

export async function getMessages(
  params: GetMessagesParams,
  authContext?: AuthContext,
): Promise<ServiceResult<any>> {
  const {
    agent: agentIdentifier,
    id: messageId,
    action,
    box = 'inbox',
  } = params

  // Resolve agent info (exact match)
  if (action === 'resolve' && agentIdentifier) {
    const resolved = resolveAgentIdentifier(agentIdentifier)
    if (!resolved) {
      return { data: { error: 'Agent not found', resolved: null }, error: 'Agent not found', status: 404 }
    }
    return { data: { resolved }, status: 200 }
  }

  // Search agents (partial/fuzzy match)
  if (action === 'search' && agentIdentifier) {
    const matches = searchAgents(agentIdentifier)
    const selfHostId = getSelfHostId()
    const selfHost = getSelfHost()

    const results = matches.map(agent => ({
      agentId: agent.id,
      alias: agent.name,
      name: agent.name,
      label: agent.label,
      displayName: agent.label || agent.name,
      hostId: selfHostId,
      hostUrl: selfHost?.url || `http://localhost:23000`,
    }))

    return {
      data: {
        query: agentIdentifier,
        count: results.length,
        results,
      },
      status: 200,
    }
  }

  // Object-level authz: every branch below reads a specific agent's mailbox
  // content (messages, counts, stats). The directory-discovery actions
  // (resolve/search/agents/sessions) handled above are intentionally exempt —
  // an agent may look up OTHER agents to message them, it just cannot read
  // their mailbox. Defence-in-depth behind the route-level override.
  const ownershipDenial = denyForeignMailbox(agentIdentifier, authContext)
  if (ownershipDenial) return ownershipDenial

  // Get specific message
  if (agentIdentifier && messageId) {
    const message = await getMessage(agentIdentifier, messageId, box as 'inbox' | 'sent')
    if (!message) {
      return { error: 'Message not found', status: 404 }
    }
    return { data: message, status: 200 }
  }

  // Get unread count (inbox only)
  if (action === 'unread-count' && agentIdentifier) {
    const count = await getUnreadCount(agentIdentifier)
    return { data: { count }, status: 200 }
  }

  // Get sent count
  if (action === 'sent-count' && agentIdentifier) {
    const count = await getSentCount(agentIdentifier)
    return { data: { count }, status: 200 }
  }

  // Get message stats
  if (action === 'stats' && agentIdentifier) {
    const stats = await getMessageStats(agentIdentifier)
    return { data: stats, status: 200 }
  }

  // List all agents with messages
  if (action === 'agents' || action === 'sessions') {
    const agents = await listAgentsWithMessages()
    return { data: { agents, sessions: agents }, status: 200 }
  }

  // Validate action parameter: if provided but not one of the recognized values, reject with 400
  const RECOGNIZED_ACTIONS = ['resolve', 'search', 'unread-count', 'sent-count', 'stats', 'agents', 'sessions', 'list']
  if (action && !RECOGNIZED_ACTIONS.includes(action)) {
    return { error: `Invalid action: '${String(action).slice(0, 50)}'. Valid actions: ${RECOGNIZED_ACTIONS.join(', ')}`, status: 400 }
  }

  // List messages for an agent
  if (!agentIdentifier) {
    return { error: 'Agent identifier required (agent ID, alias, or session name)', status: 400 }
  }

  // Parse limit parameter (default: 25 for performance, 0 = unlimited)
  const limit = params.limit === null || params.limit === undefined
    ? 25
    : parseInt(params.limit, 10) || 0

  // List sent messages
  if (box === 'sent') {
    const priority = params.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined
    const to = params.to || undefined

    const messages = await listSentMessages(agentIdentifier, { priority, to, limit })
    return { data: { messages, limit }, status: 200 }
  }

  // List inbox messages (default)
  const status = params.status as 'unread' | 'read' | 'archived' | undefined
  const priority = params.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined
  const from = params.from || undefined

  const messages = await listInboxMessages(agentIdentifier, { status, priority, from, limit })
  return { data: { messages, limit }, status: 200 }
}

// ---------------------------------------------------------------------------
// Messages: POST /api/messages
// ---------------------------------------------------------------------------

export interface SendMessageParams {
  from: string
  to: string
  subject: string
  content: {
    type: 'request' | 'response' | 'notification' | 'update'
    message: string
    context?: Record<string, unknown>
    attachments?: Array<{ name: string; path: string; type: string }>
  }
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  inReplyTo?: string
  fromHost?: string
  toHost?: string
  fromAlias?: string
  toAlias?: string
  fromLabel?: string
  toLabel?: string
  fromVerified?: boolean
  /** SVC2-CRIT-03 fix: caller's verified identity, forwarded to SendMessage.G04.AUTH */
  authContext: AuthContext
}

export async function sendMessage(params: SendMessageParams): Promise<ServiceResult<any>> {
  const { from, to, subject, content } = params

  if (!params.authContext) {
    return { error: 'Auth context required', status: 401 }
  }

  // Delegate to the unified SendMessage AIO pipeline
  const { SendMessage } = await import('@/services/send-message-service')
  const result = await SendMessage({
    from: from || '',
    to: to || '',
    subject: subject || '',
    content: content ? { type: content.type, message: content.message, context: content.context } : { type: 'notification', message: '' },
    priority: params.priority,
    inReplyTo: params.inReplyTo,
    // User/UI messages skip graph check (R6.6: user is exempt)
    skipGraphCheck: true,
    authContext: params.authContext,
  })

  if (!result.success) {
    return { error: result.error || 'Failed to send message', status: 400 }
  }

  return {
    data: {
      message: { id: result.messageId },
      notified: result.notified,
    },
    status: 201,
  }
}

// ---------------------------------------------------------------------------
// Messages: PATCH /api/messages
// ---------------------------------------------------------------------------

export async function updateMessage(
  agentIdentifier: string | null,
  messageId: string | null,
  action: string | null,
  authContext?: AuthContext,
): Promise<ServiceResult<{ success: boolean }>> {
  if (!agentIdentifier || !messageId) {
    return { error: 'Agent identifier and message ID required', status: 400 }
  }

  // Object-level authz (defence-in-depth): an authenticated agent may only
  // mark-read/archive its OWN messages. System owner exempt; no authContext
  // → route guard is authoritative.
  const ownershipDenial = denyForeignMailbox(agentIdentifier, authContext)
  if (ownershipDenial) return ownershipDenial

  try {
    let success = false

    switch (action) {
      case 'read':
        success = await markMessageAsRead(agentIdentifier, messageId)
        break
      case 'archive':
        success = await archiveMessage(agentIdentifier, messageId)
        break
      default:
        return { error: 'Invalid action', status: 400 }
    }

    if (!success) {
      return { error: 'Message not found', status: 404 }
    }

    return { data: { success: true }, status: 200 }
  } catch (error) {
    console.error('Error updating message:', error)
    return { error: 'Failed to update message', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// Messages: DELETE /api/messages
// ---------------------------------------------------------------------------

export async function removeMessage(
  agentIdentifier: string | null,
  messageId: string | null,
  authContext?: AuthContext,
): Promise<ServiceResult<{ success: boolean }>> {
  if (!agentIdentifier || !messageId) {
    return { error: 'Agent identifier and message ID required', status: 400 }
  }

  // Object-level authz (defence-in-depth): an authenticated agent may only
  // delete its OWN messages. System owner exempt; no authContext → route
  // guard is authoritative.
  const ownershipDenial = denyForeignMailbox(agentIdentifier, authContext)
  if (ownershipDenial) return ownershipDenial

  try {
    const success = await deleteMessage(agentIdentifier, messageId)

    if (!success) {
      return { error: 'Message not found', status: 404 }
    }

    return { data: { success: true }, status: 200 }
  } catch (error) {
    console.error('Error deleting message:', error)
    return { error: 'Failed to delete message', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// Messages: POST /api/messages/forward
// ---------------------------------------------------------------------------

export interface ForwardMessageParams {
  messageId?: string
  originalMessage?: any
  fromSession: string
  toSession: string
  forwardNote?: string
}

export async function forwardMessage(params: ForwardMessageParams): Promise<ServiceResult<any>> {
  const { messageId, originalMessage, fromSession, toSession, forwardNote } = params

  // Validate required fields
  if ((!messageId && !originalMessage) || !fromSession || !toSession) {
    return {
      error: 'Either messageId or originalMessage, plus fromSession and toSession are required',
      status: 400,
    }
  }

  // Validate session identifier format: length limit and no control characters
  const SESSION_MAX_LEN = 200
  const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/
  if (fromSession.length > SESSION_MAX_LEN || CONTROL_CHAR_RE.test(fromSession)) {
    return { error: 'Invalid fromSession format', status: 400 }
  }
  if (toSession.length > SESSION_MAX_LEN || CONTROL_CHAR_RE.test(toSession)) {
    return { error: 'Invalid toSession format', status: 400 }
  }

  // Validate that from and to sessions are different
  if (fromSession === toSession) {
    return { error: 'Cannot forward message to the same session', status: 400 }
  }

  try {
    // Pass undefined instead of empty string when messageId is missing,
    // to avoid silent lookup failures if the calling pattern changes
    const result = await forwardFromUI({
      originalMessageId: messageId || undefined,
      fromAgent: fromSession,
      toAgent: toSession,
      forwardNote: forwardNote || undefined,
      providedOriginalMessage: originalMessage || undefined,
    })

    return {
      data: {
        success: true,
        message: 'Message forwarded successfully',
        forwardedMessage: {
          id: result.message.id,
          to: result.message.to,
          subject: result.message.subject,
        },
      },
      status: 200,
    }
  } catch (error) {
    console.error('Error forwarding message:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to forward message',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// Messages: GET /api/messages/meeting
// ---------------------------------------------------------------------------

export interface GetMeetingMessagesParams {
  meetingId: string | null
  participants: string | null
  since: string | null
}

export async function getMeetingMessages(
  params: GetMeetingMessagesParams,
): Promise<ServiceResult<{ meetingId: string; messages: MessageSummary[]; count: number }>> {
  const { meetingId, participants: participantsParam, since } = params

  if (!meetingId) {
    return { error: 'meetingId is required', status: 400 }
  }
  if (!participantsParam) {
    return { error: 'participants is required', status: 400 }
  }

  const participantIds = participantsParam.split(',').filter(Boolean)
  // Include 'maestro' as a pseudo-participant
  const allParticipants = [...new Set([...participantIds, 'maestro'])]

  const seenIds = new Set<string>()
  const meetingMessages: MessageSummary[] = []

  // Fetch inbox and sent for each participant
  for (const participantId of allParticipants) {
    try {
      const [inbox, sent] = await Promise.all([
        listInboxMessages(participantId, { limit: 0, previewLength: 2000 }),
        listSentMessages(participantId, { limit: 0, previewLength: 2000 }),
      ])

      const allMessages = [...inbox, ...sent]

      for (const msg of allMessages) {
        if (seenIds.has(msg.id)) continue
        // Check if message belongs to this meeting (subject prefix or context tag)
        if (msg.subject.startsWith(`[MEETING:${meetingId}]`)) {
          if (since && new Date(msg.timestamp) <= new Date(since)) continue
          seenIds.add(msg.id)
          meetingMessages.push(msg)
        }
      }
    } catch {
      // Skip participants that can't be resolved
    }
  }

  // Sort chronologically (oldest first for chat display)
  meetingMessages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )

  // Deduplicate broadcast messages: same sender + same preview + similar timestamp -> keep one
  const deduped: MessageSummary[] = []
  const broadcastSeen = new Set<string>()
  for (const msg of meetingMessages) {
    // Create a key from sender + preview + second-level timestamp
    const ts = msg.timestamp.slice(0, 19) // trim to second precision
    const dedupeKey = `${msg.from}|${msg.preview}|${ts}`
    if (broadcastSeen.has(dedupeKey)) continue
    broadcastSeen.add(dedupeKey)
    deduped.push(msg)
  }

  return {
    data: {
      meetingId,
      messages: deduped,
      count: deduped.length,
    },
    status: 200,
  }
}

// ---------------------------------------------------------------------------
// Meetings: GET /api/meetings
// ---------------------------------------------------------------------------

export function listMeetings(statusFilter?: string | null): ServiceResult<{ meetings: any[] }> {
  const loaded = loadMeetings()
  if (!loaded) {
    return { error: 'Failed to load meetings file', status: 500 }
  }
  let meetings = loaded
  if (statusFilter) {
    meetings = meetings.filter(m => m.status === statusFilter)
  }
  return { data: { meetings }, status: 200 }
}

// ---------------------------------------------------------------------------
// Meetings: POST /api/meetings
// ---------------------------------------------------------------------------

export interface CreateMeetingParams {
  name: string
  agentIds: string[]
  teamId?: string | null
  groupId?: string | null  // Link to group when meeting started from a group
  sidebarMode?: SidebarMode
}

export async function createNewMeeting(
  params: CreateMeetingParams,
): Promise<ServiceResult<{ meeting: any }>> {
  const { name, agentIds, teamId, groupId, sidebarMode } = params

  if (!name || typeof name !== 'string') {
    return { error: 'Meeting name is required', status: 400 }
  }

  if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
    return { error: 'At least one agent is required', status: 400 }
  }

  try {
    const meeting = await createMeeting({
      name,
      agentIds,
      teamId: teamId || null,
      // Persist groupId so the meeting can be linked back to its source group
      groupId: groupId || null,
      sidebarMode,
    })
    return { data: { meeting }, status: 201 }
  } catch (error) {
    console.error('Failed to create meeting:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to create meeting',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// Meetings: GET /api/meetings/[id]
// ---------------------------------------------------------------------------

export function getMeetingById(id: string): ServiceResult<{ meeting: any }> {
  const meeting = getMeeting(id)
  if (!meeting) {
    return { error: 'Meeting not found', status: 404 }
  }
  return { data: { meeting }, status: 200 }
}

// ---------------------------------------------------------------------------
// Meetings: PATCH /api/meetings/[id]
// ---------------------------------------------------------------------------

export interface UpdateMeetingParams {
  name?: string
  agentIds?: string[]
  status?: string
  activeAgentId?: string | null
  sidebarMode?: SidebarMode
  lastActiveAt?: string
  endedAt?: string
  teamId?: string | null
}

// Allowed meeting status values for runtime validation
const VALID_MEETING_STATUSES = ['active', 'ended'] as const

export async function updateExistingMeeting(
  id: string,
  updates: UpdateMeetingParams,
): Promise<ServiceResult<{ meeting: any }>> {
  try {
    // Validate status at runtime instead of casting to any
    if (updates.status !== undefined && !VALID_MEETING_STATUSES.includes(updates.status as any)) {
      return { error: `Invalid meeting status: "${updates.status}". Must be one of: ${VALID_MEETING_STATUSES.join(', ')}`, status: 400 }
    }

    const meeting = await updateMeeting(id, {
      name: updates.name,
      agentIds: updates.agentIds,
      status: updates.status as typeof VALID_MEETING_STATUSES[number],
      activeAgentId: updates.activeAgentId,
      sidebarMode: updates.sidebarMode,
      lastActiveAt: updates.lastActiveAt,
      endedAt: updates.endedAt,
      teamId: updates.teamId,
    })
    if (!meeting) {
      return { error: 'Meeting not found', status: 404 }
    }

    return { data: { meeting }, status: 200 }
  } catch (error) {
    console.error('Failed to update meeting:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to update meeting',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// Meetings: DELETE /api/meetings/[id]
// ---------------------------------------------------------------------------

export async function deleteExistingMeeting(id: string): Promise<ServiceResult<{ success: boolean }>> {
  const deleted = await deleteMeeting(id)
  if (!deleted) {
    return { error: 'Meeting not found', status: 404 }
  }
  return { data: { success: true }, status: 200 }
}
