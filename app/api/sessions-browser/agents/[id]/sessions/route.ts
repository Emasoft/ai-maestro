import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  getSessionsForAgentWithMetadata,
  hasSessionCookie,
} from '@/services/sessions-browser-service'

export const dynamic = 'force-dynamic'

// Response schema — validated before returning (acceptance criterion #3).
// Phase 5 §4 extends this with three optional metadata fields
// (`firstUserText`, `isOngoing`, `compactionCount`). They are OPTIONAL so
// existing callers that don't know about them continue to parse the
// response unchanged.
const SessionSummarySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative().nullable(),
  lastModified: z.string(),
  displayName: z.string(),
  id: z.string(),
  firstUserText: z.string().optional(),
  isOngoing: z.boolean().optional(),
  compactionCount: z.number().int().nonnegative().optional(),
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
  // Phase 5 §4 — fetch the list enriched with metadata. Falls back to
  // plain file-system rows when the Rust analyzer fails (metadata fields
  // remain undefined; response still parses against the schema above).
  const result = await getSessionsForAgentWithMetadata(id)
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = SessionsListResponseSchema.parse(result.data)
  return NextResponse.json(validated)
}
