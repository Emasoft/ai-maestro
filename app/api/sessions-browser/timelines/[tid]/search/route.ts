import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasSessionCookie } from '@/services/sessions-browser-service'
import { searchTimeline } from '@/services/sessions-timeline-service'

export const dynamic = 'force-dynamic'

const MatchSchema = z.object({
  globalLineIndex: z.number().int().nonnegative(),
  laneId: z.string(),
  sessionId: z.string(),
  fileIndex: z.number().int().nonnegative(),
  localLineIndex: z.number().int().nonnegative(),
  byteOffset: z.number().int().nonnegative(),
  snippet: z.string(),
})

const SearchResponseSchema = z.object({
  timelineId: z.string(),
  matches: z.array(MatchSchema),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tid: string }> },
) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { tid } = await params
  const url = new URL(request.url)
  const q = url.searchParams.get('q')
  if (!q) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'q is required' },
      { status: 400 },
    )
  }
  const kindParam = url.searchParams.get('kind')
  let kind: 'substring' | 'regex' | undefined
  if (kindParam === 'substring' || kindParam === 'regex') kind = kindParam
  else if (kindParam !== null) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'kind must be substring or regex' },
      { status: 400 },
    )
  }
  const ciParam = url.searchParams.get('ci')
  let caseInsensitive: boolean | undefined
  if (ciParam === 'true' || ciParam === '1') caseInsensitive = true
  else if (ciParam === 'false' || ciParam === '0') caseInsensitive = false

  const result = await searchTimeline(tid, q, { kind, caseInsensitive })
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = SearchResponseSchema.parse({
    timelineId: tid,
    matches: result.data.matches,
  })
  return NextResponse.json(validated)
}
