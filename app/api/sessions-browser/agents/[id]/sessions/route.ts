import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  getSessionsForAgent,
  hasSessionCookie,
} from '@/services/sessions-browser-service'

export const dynamic = 'force-dynamic'

// Response schema — validated before returning (acceptance criterion #3).
const SessionSummarySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative().nullable(),
  lastModified: z.string(),
  displayName: z.string(),
  id: z.string(),
})

const SessionsListResponseSchema = z.object({
  projectDir: z.string().nullable(),
  sessions: z.array(SessionSummarySchema),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const result = getSessionsForAgent(id)
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = SessionsListResponseSchema.parse(result.data)
  return NextResponse.json(validated)
}
