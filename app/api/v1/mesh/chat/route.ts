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
    console.error('[mesh/chat] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to fetch messages: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}

// POST /api/v1/mesh/chat
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

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

    const msg = {
      id: uuidv4(),
      senderHostId: parsed.data.senderHostId,
      senderName: parsed.data.senderName,
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
    console.error('[mesh/chat] POST failed:', error)
    return NextResponse.json(
      { error: `Failed to post message: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}
