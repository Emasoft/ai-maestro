/**
 * GET /api/v1/mesh/chat/history — Returns older messages with cursor pagination.
 *
 * Query params:
 *   limit  — max messages to return (default 50, max 200)
 *   before — ISO timestamp cursor; only messages BEFORE this time are returned
 *
 * Returns { messages, hasMore, nextCursor }.
 * nextCursor is the timestamp of the oldest message returned — pass it as
 * `before` in the next request to page backward through history.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMessages, getMessageCount } from '@/lib/vpn-chat-log'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// GET /api/v1/mesh/chat/history?limit=50&before=<ISO timestamp>
export async function GET(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const beforeParam = searchParams.get('before')

    // Validate limit
    let limit = DEFAULT_LIMIT
    if (limitParam) {
      const parsed = parseInt(limitParam, 10)
      if (isNaN(parsed) || parsed < 1) {
        return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 })
      }
      limit = Math.min(parsed, MAX_LIMIT)
    }

    // `before` is required for history endpoint — this is backward pagination
    if (!beforeParam) {
      return NextResponse.json(
        { error: 'Missing required query parameter: before (ISO timestamp)' },
        { status: 400 },
      )
    }

    const messages = getMessages(limit, beforeParam)

    // hasMore: check if there are messages before the oldest returned message
    let hasMore = false
    if (messages.length > 0) {
      const oldestReturned = messages[0].timestamp
      const olderMessages = getMessages(1, oldestReturned)
      hasMore = olderMessages.length > 0
    }

    return NextResponse.json({
      messages,
      hasMore,
      nextCursor: messages.length > 0 ? messages[0].timestamp : undefined,
      totalCount: getMessageCount(),
    }, { status: 200 })
  } catch (error) {
    console.error('[mesh/chat/history] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to fetch chat history: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}
