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

// Request body schema
const RangeBodySchema = z.object({
  fromLine: z.number().int().nonnegative(),
  toLine: z.number().int().nonnegative(),
})

// Response schema — validated before returning (acceptance criterion #3).
const RangeResponseSchema = z.object({
  sessionId: z.string(),
  fromLine: z.number().int().nonnegative(),
  toLine: z.number().int().nonnegative(),
  lines: z.array(z.unknown()),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { sid } = await params

  // Resolve UI sid (UUID) → absolute path.
  //
  // Two resolution paths (in order):
  //   1. Authoritative `?path=<abs>` query param — the list endpoint returns
  //      every session's absolute `path`; the UI sends it back verbatim. This
  //      works regardless of which Next.js worker process serves the request,
  //      because it carries the path explicitly instead of relying on the
  //      in-memory `sidToPath` cache (which is per-process and not shared
  //      across Next.js compilation workers in dev/RSC mode — confirmed by
  //      SCEN-027 BUG-001 on 2026-04-26: list-population in worker A was not
  //      visible to range-resolution in worker B, causing 404).
  //   2. Fallback to the in-memory `sidToPath` map populated by a previous
  //      list call in the same worker process. Kept for backward compat with
  //      callers that don't yet pass `?path=` and for warm-cache cases.
  const url = new URL(request.url)
  const pathParam = url.searchParams.get('path')
  const absolutePath = pathParam || resolveSessionPath(sid)
  if (!absolutePath) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const parsed = RangeBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', detail: parsed.error.message },
      { status: 400 },
    )
  }

  try {
    const readerSid = await ensureOpenForPath(absolutePath)
    const resp = await getJsonlReader().readRange(
      readerSid,
      parsed.data.fromLine,
      parsed.data.toLine,
    )
    const validated = RangeResponseSchema.parse({
      sessionId: sid,
      fromLine: parsed.data.fromLine,
      toLine: parsed.data.toLine,
      lines: resp.lines,
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
