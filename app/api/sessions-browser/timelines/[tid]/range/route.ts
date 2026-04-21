import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasSessionCookie } from '@/services/sessions-browser-service'
import { readTimelineRange } from '@/services/sessions-timeline-service'

export const dynamic = 'force-dynamic'

const RowSchema = z.object({
  sessionId: z.string(),
  laneId: z.string(),
  fileIndex: z.number().int().nonnegative(),
  localLineIndex: z.number().int().nonnegative(),
  globalLineIndex: z.number().int().nonnegative(),
  raw: z.unknown(),
})

const RangeResponseSchema = z.object({
  timelineId: z.string(),
  fromGlobal: z.number().int().nonnegative(),
  toGlobal: z.number().int().nonnegative(),
  rows: z.array(RowSchema),
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
  const fromStr = url.searchParams.get('fromGlobal')
  const toStr = url.searchParams.get('toGlobal')
  if (fromStr === null || toStr === null) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'fromGlobal and toGlobal are required' },
      { status: 400 },
    )
  }
  const fromGlobal = Number(fromStr)
  const toGlobal = Number(toStr)
  if (
    !Number.isInteger(fromGlobal) ||
    !Number.isInteger(toGlobal) ||
    fromGlobal < 0 ||
    toGlobal < 0
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const result = await readTimelineRange(tid, fromGlobal, toGlobal)
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = RangeResponseSchema.parse({
    timelineId: tid,
    fromGlobal,
    toGlobal,
    rows: result.data.rows,
  })
  return NextResponse.json(validated)
}
