/**
 * GET  /api/v1/mesh/chat — Returns recent chat messages (paginated).
 * POST /api/v1/mesh/chat — Appends a new message to the chat log.
 *
 * Both endpoints require authentication. The chat log is append-only.
 * POST validates content length (1..4096 chars) and message type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { appendMessage, getMessages } from '@/lib/vpn-chat-log'
import { isValidChatMessage } from '@/types/vpn-chat'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { getSelfHostId, isSelf } from '@/lib/hosts-config'
import { getAgent } from '@/lib/agent-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

const MAX_CONTENT_LENGTH = 4096
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const PostMessageSchema = z.object({
  senderHostId: z.string().min(1).max(128),
  senderName: z.string().min(1).max(128),
  content: z.string().min(1).max(MAX_CONTENT_LENGTH),
  type: z.enum(['text', 'system']).default('text'),
  replyTo: z.string().max(256).optional(),
  mentions: z.array(z.string().max(256)).max(50).optional(),
}).strict()

// GET /api/v1/mesh/chat?limit=50&before=<ISO timestamp>
export async function GET(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const beforeParam = searchParams.get('before')

    let limit = DEFAULT_LIMIT
    if (limitParam) {
      const parsed = parseInt(limitParam, 10)
      if (isNaN(parsed) || parsed < 1) {
        return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
      }
      limit = Math.min(parsed, MAX_LIMIT)
    }

    const before = beforeParam ?? undefined
    const messages = getMessages(limit, before)

    // Determine if there are older messages
    const hasMore = before
      ? getMessages(1, undefined).length > 0 && messages.length === limit
      : messages.length === limit

    return NextResponse.json({
      messages,
      hasMore,
      nextCursor: messages.length > 0 ? messages[0].timestamp : undefined,
    }, { status: 200 })
  } catch (error) {
    return internalError(error, 'mesh-chat-get')
  }
}

// POST /api/v1/mesh/chat
export async function POST(request: NextRequest) {
  // API2-MAJ-09: full token verification (not just middleware) so we know
  // the actual identity behind the call and can reject sender-spoofing.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = PostMessageSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    // API2-MAJ-09: derive verified senderHostId/senderName from the
    // authenticated identity. Reject any body that claims a sender other
    // than the caller.
    let verifiedSenderHostId: string
    let verifiedSenderName: string
    if (auth.agentId) {
      // Agent caller — must claim its own agent name and the local host
      const agent = getAgent(auth.agentId)
      if (!agent) {
        return NextResponse.json(
          { error: 'agent_not_found', message: 'Authenticated agent not in registry' },
          { status: 401 },
        )
      }
      verifiedSenderHostId = getSelfHostId()
      verifiedSenderName = agent.name
      // Reject if body senderName disagrees with the registered agent name
      if (parsed.data.senderName !== agent.name) {
        return NextResponse.json(
          {
            error: 'sender_mismatch',
            message: 'senderName does not match authenticated agent identity',
          },
          { status: 403 },
        )
      }
      // Reject if body senderHostId doesn't refer to this host. Cross-host
      // mesh delivery requires Ed25519 attestation (not yet wired here).
      if (!isSelf(parsed.data.senderHostId)) {
        return NextResponse.json(
          {
            error: 'sender_host_mismatch',
            message: 'Cross-host posting requires an attested federated path, not this endpoint.',
          },
          { status: 403 },
        )
      }
    } else {
      // System-owner / web user — sender is the local host with the
      // body-supplied display name (which is just a label here, not a
      // governance claim).
      verifiedSenderHostId = getSelfHostId()
      verifiedSenderName = parsed.data.senderName
      if (!isSelf(parsed.data.senderHostId)) {
        return NextResponse.json(
          { error: 'sender_host_mismatch', message: 'Cannot post on behalf of a remote host' },
          { status: 403 },
        )
      }
    }

    const msg = {
      id: uuidv4(),
      senderHostId: verifiedSenderHostId,
      senderName: verifiedSenderName,
      content: parsed.data.content,
      timestamp: new Date().toISOString(),
      type: parsed.data.type,
      ...(parsed.data.replyTo ? { replyTo: parsed.data.replyTo } : {}),
      ...(parsed.data.mentions ? { mentions: parsed.data.mentions } : {}),
    }

    // Final validation gate before persisting
    if (!isValidChatMessage(msg)) {
      return NextResponse.json(
        { error: 'Message failed post-construction validation' },
        { status: 400 },
      )
    }

    appendMessage(msg)

    return NextResponse.json({ ok: true, message: msg }, { status: 201 })
  } catch (error) {
    return internalError(error, 'mesh-chat-post')
  }
}
