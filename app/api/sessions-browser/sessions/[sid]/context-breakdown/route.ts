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
  // Phase 6 additions: skills tokens + autocompact buffer reservation.
  // Allow zero so older readers (Rust binary, pre-Phase-6) still validate.
  skills: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  autocompactBuffer: z.number().int().nonnegative(),
  freeSpace: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  modelContextLimit: z.number().int().nonnegative(),
  approximate: z.boolean(),
  modelId: z.string().nullable(),
  source: z.enum(['recorded', 'heuristic']).optional(),
  capturedAtLineIndex: z.number().int().nullable().optional(),
  capturedAtTimestamp: z.string().nullable().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  if (!hasSessionCookie(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { sid } = await params
  // See range/route.ts for the rationale on `?path=` fallback (SCEN-027 BUG-001).
  // Cross-worker map-staleness is the documented failure mode; carrying the path
  // back from the list response is the safe round-trip.
  const url = new URL(request.url)
  const pathParam = url.searchParams.get('path')
  const absolutePath = pathParam || resolveSessionPath(sid)
  if (!absolutePath) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  }

  // Phase 6 — `?atIndex=N` selects the snapshot at or before the
  // user's currently-selected transcript message. Defaults to the
  // most recent snapshot when omitted. Negative or non-numeric
  // values are silently treated as omitted.
  const atIndexRaw = url.searchParams.get('atIndex')
  let atOrBeforeLineIndex: number | undefined
  if (atIndexRaw !== null) {
    const parsed = Number.parseInt(atIndexRaw, 10)
    if (Number.isFinite(parsed) && parsed >= 0) atOrBeforeLineIndex = parsed
  }

  // Live-tail safety: if a parallel poll-tick mtime-evicts the same
  // path between our `ensureOpenForPath` and the actual reader call,
  // the reader will return `session_not_found`. Retry up to
  // MAX_ATTEMPTS times — each retry acquires a fresh sid serialised
  // against concurrent evictions by the per-path lock in
  // `JsonlReader.open()`. Two consecutive evictions are unusual but
  // possible when several panes poll in parallel; three tries make
  // that tolerant. See range/route.ts for the matching implementation.
  const MAX_ATTEMPTS = 3
  async function callWithRetry(): Promise<Awaited<ReturnType<ReturnType<typeof getJsonlReader>['contextBreakdown']>>> {
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const readerSid = await ensureOpenForPath(absolutePath!)
      try {
        return await getJsonlReader().contextBreakdown(readerSid, { atOrBeforeLineIndex })
      } catch (err) {
        lastErr = err
        if (
          err instanceof JsonlReaderProtocolError &&
          err.code === 'session_not_found' &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 30)))
          continue
        }
        throw err
      }
    }
    throw lastErr
  }

  try {
    const resp = await callWithRetry()
    const validated = ContextBreakdownResponseSchema.parse({
      sessionId: sid,
      systemPrompt: resp.systemPrompt,
      systemTools: resp.systemTools,
      mcpTools: resp.mcpTools,
      customAgents: resp.customAgents,
      memory: resp.memory,
      // Defensive defaults so the route still validates when an older
      // Rust reader is in the loop and doesn't return the new fields.
      skills: resp.skills ?? 0,
      messages: resp.messages,
      autocompactBuffer: resp.autocompactBuffer ?? 0,
      freeSpace: resp.freeSpace,
      cacheRead: resp.cacheRead,
      total: resp.total,
      modelContextLimit: resp.modelContextLimit,
      approximate: resp.approximate,
      modelId: resp.modelId,
      source: resp.source,
      capturedAtLineIndex: resp.capturedAtLineIndex ?? null,
      capturedAtTimestamp: resp.capturedAtTimestamp ?? null,
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
