import { NextRequest, NextResponse } from 'next/server'
import { getMeetingMessages } from '@/services/messages-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

/**
 * GET /api/messages/meeting?meetingId=<id>&participants=<id1,id2,...>&since=<timestamp>
 */
export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const { searchParams } = new URL(request.url)

  // SF-002: Validate that at least meetingId is provided
  const meetingId = searchParams.get('meetingId')
  if (!meetingId || typeof meetingId !== 'string') {
    return NextResponse.json({ error: 'meetingId required' }, { status: 400 })
  }

  // Sanitize participants: must be comma-separated alphanumeric/hyphen/underscore IDs
  const rawParticipants = searchParams.get('participants')
  if (rawParticipants && !/^[a-zA-Z0-9_,@.-]+$/.test(rawParticipants)) {
    return NextResponse.json({ error: 'participants contains invalid characters' }, { status: 400 })
  }

  // Validate since: must be a valid ISO date or numeric timestamp
  const rawSince = searchParams.get('since')
  if (rawSince) {
    const sinceDate = new Date(rawSince)
    if (isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: 'since must be a valid date or timestamp' }, { status: 400 })
    }
  }

  const result = await getMeetingMessages({
    meetingId,
    participants: rawParticipants,
    since: rawSince,
  })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
