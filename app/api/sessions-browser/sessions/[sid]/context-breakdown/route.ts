import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  hasSessionCookie,
  resolveSessionPath,
  ensureOpenForPath,
} from '@/services/sessions-browser-service'
import {
  JsonlReaderBinaryMissingError,
  JsonlReaderProtocolError,
  getJsonlReader,
} from '@/lib/jsonl-reader'

export const dynamic = 'force-dynamic'

const ContextBreakdownResponseSchema = z.object({
  sessionId: z.string(),
  systemPrompt: z.number().int().nonnegative(),
  systemTools: z.number().int().nonnegative(),
  mcpTools: z.number().int().nonnegative(),
  customAgents: z.number().int().nonnegative(),
  memory: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  freeSpace: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  modelContextLimit: z.number().int().nonnegative(),
  approximate: z.boolean(),
  modelId: z.string().nullable(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { sid } = await params
  const absolutePath = resolveSessionPath(sid)
  if (!absolutePath) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  }

  try {
    const readerSid = await ensureOpenForPath(absolutePath)
    const resp = await getJsonlReader().contextBreakdown(readerSid)
    const validated = ContextBreakdownResponseSchema.parse({
      sessionId: sid,
      systemPrompt: resp.systemPrompt,
      systemTools: resp.systemTools,
      mcpTools: resp.mcpTools,
      customAgents: resp.customAgents,
      memory: resp.memory,
      messages: resp.messages,
      freeSpace: resp.freeSpace,
      cacheRead: resp.cacheRead,
      total: resp.total,
      modelContextLimit: resp.modelContextLimit,
      approximate: resp.approximate,
      modelId: resp.modelId,
    })
    return NextResponse.json(validated)
  } catch (err) {
    if (err instanceof JsonlReaderBinaryMissingError) {
      return NextResponse.json(
        { error: 'binary_missing', detail: err.message },
        { status: 503 },
      )
    }
    if (err instanceof JsonlReaderProtocolError) {
      const status = err.code === 'session_not_found' ? 404 : 502
      return NextResponse.json(
        { error: err.code, detail: err.detail },
        { status },
      )
    }
    return NextResponse.json(
      { error: 'internal_error', detail: (err as Error).message },
      { status: 500 },
    )
  }
}
