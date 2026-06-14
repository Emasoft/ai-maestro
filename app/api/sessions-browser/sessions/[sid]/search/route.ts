import { homedir } from 'node:os'
import path from 'node:path'

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

/**
 * Confine a caller-supplied `?path=` to the Claude Code transcript store
 * (`~/.claude/projects/<slug>/...<uuid>.jsonl`). The raw `?path=` is
 * attacker-controlled — any authenticated session can pass
 * `?path=/etc/passwd` — and the downstream reader (`ensureOpenForPath` →
 * Rust `open` → `fs.readFile`) does NOT confine it, so the gate has to
 * live here at the request boundary. Mirrors `confineToProjectsStore` in
 * the sibling context-breakdown route — the same fail-fast boundary for
 * the same `?path=` surface. `path.resolve` collapses any `..` traversal,
 * so a post-resolve `.jsonl`-suffix + projects-root-prefix check is the
 * correct lexical confinement (no symlink follow — the reader does none
 * either). Returns the resolved absolute path, or `null` to reject.
 */
function confineToProjectsStore(rawPath: string): string | null {
  const resolved = path.resolve(rawPath)
  if (!resolved.endsWith('.jsonl')) return null
  const projectsRoot = path.join(homedir(), '.claude', 'projects')
  if (!resolved.startsWith(projectsRoot + path.sep)) return null
  return resolved
}

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
  // See range/route.ts for the rationale on `?path=` fallback (SCEN-027 BUG-001).
  // Cross-worker map-staleness is the documented failure mode; carrying the path
  // back from the list response is the safe round-trip.
  //
  // The `?path=` form is caller-controlled, so it MUST be confined to the
  // Claude Code transcript store before it reaches the reader (which opens
  // it unguarded). A path outside the store is a path-traversal attempt —
  // reject it explicitly rather than letting the reader read an arbitrary
  // file. The `resolveSessionPath(sid)` fallback is server-derived (recorded
  // by `listSessionsInProjectDir`, always under `~/.claude/projects/`) and
  // needs no re-check.
  const url = new URL(request.url)
  const pathParam = url.searchParams.get('path')
  let absolutePath: string | null
  if (pathParam) {
    absolutePath = confineToProjectsStore(pathParam)
    if (!absolutePath) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 })
    }
  } else {
    absolutePath = resolveSessionPath(sid)
  }
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

  // Live-tail safety: parallel poll-ticks may mtime-evict the path
  // between our open and our search. Retry up to MAX_ATTEMPTS times on
  // `session_not_found` for the same reason documented in range/route.ts
  // and context-breakdown/route.ts.
  const { query, kind, caseInsensitive, limit } = parsed.data
  const MAX_ATTEMPTS = 3
  async function searchWithRetry() {
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const readerSid = await ensureOpenForPath(absolutePath!)
      try {
        return await getJsonlReader().search(readerSid, query, {
          kind,
          caseInsensitive,
          limit,
        })
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
    const resp = await searchWithRetry()
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
