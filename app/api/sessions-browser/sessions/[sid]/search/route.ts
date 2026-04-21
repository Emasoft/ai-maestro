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

const SearchBodySchema = z.object({
  query: z.string().min(1),
  kind: z.enum(['substring', 'regex']).optional(),
  caseInsensitive: z.boolean().optional(),
  limit: z.number().int().positive().max(10_000).optional(),
})

const SearchMatchSchema = z.object({
  line: z.number().int().nonnegative(),
  byteOffset: z.number().int().nonnegative(),
  snippet: z.string(),
})

const SearchResponseSchema = z.object({
  sessionId: z.string(),
  matches: z.array(SearchMatchSchema),
})

export async function POST(
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const parsed = SearchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', detail: parsed.error.message },
      { status: 400 },
    )
  }

  try {
    const readerSid = await ensureOpenForPath(absolutePath)
    const resp = await getJsonlReader().search(readerSid, parsed.data.query, {
      kind: parsed.data.kind,
      caseInsensitive: parsed.data.caseInsensitive,
      limit: parsed.data.limit,
    })
    const validated = SearchResponseSchema.parse({
      sessionId: sid,
      matches: resp.matches,
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
