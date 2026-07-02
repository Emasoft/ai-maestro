import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasValidSession } from '@/services/sessions-browser-service'
import { contextAt } from '@/services/sessions-timeline-service'

export const dynamic = 'force-dynamic'

const BucketsSchema = z.object({
  systemPrompt: z.number().int().nonnegative(),
  systemTools: z.number().int().nonnegative(),
  mcpTools: z.number().int().nonnegative(),
  customAgents: z.number().int().nonnegative(),
  memory: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  freeSpace: z.number().int().nonnegative(),
  modelContextLimit: z.number().int().nonnegative(),
  approximate: z.boolean(),
  modelId: z.string().nullable(),
})

const PhaseSchema = z.object({
  phaseId: z.number().int().nonnegative(),
  pre: z.number().int().nonnegative(),
  peak: z.number().int().nonnegative(),
  post: z.number().int().nonnegative().nullable(),
})

const ContextAtResponseSchema = z.object({
  timelineId: z.string(),
  anchorGlobalLine: z.number().int().nonnegative().nullable(),
  cumulative: BucketsSchema,
  exactAtCursor: BucketsSchema,
  phaseHistory: z.array(PhaseSchema),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tid: string }> },
) {
  if (!hasValidSession(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { tid } = await params
  const url = new URL(request.url)
  const anchorUuid = url.searchParams.get('anchorUuid')
  const globalStr = url.searchParams.get('globalLineIndex')
  let globalLineIndex: number | undefined
  if (globalStr !== null) {
    const n = Number(globalStr)
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        { error: 'invalid_request', detail: 'globalLineIndex must be a non-negative integer' },
        { status: 400 },
      )
    }
    globalLineIndex = n
  }
  if (!anchorUuid && globalLineIndex === undefined) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'anchorUuid or globalLineIndex required' },
      { status: 400 },
    )
  }

  const result = await contextAt(tid, {
    anchorUuid: anchorUuid ?? undefined,
    globalLineIndex,
  })
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = ContextAtResponseSchema.parse({
    timelineId: tid,
    anchorGlobalLine: result.data.anchorGlobalLine,
    cumulative: result.data.cumulative,
    exactAtCursor: result.data.exactAtCursor,
    phaseHistory: result.data.phaseHistory,
  })
  return NextResponse.json(validated)
}
