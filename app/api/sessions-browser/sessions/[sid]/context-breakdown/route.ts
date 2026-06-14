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
 * (`~/.claude/projects/<slug>/...<uuid>.jsonl`, plus subagent sidecars
 * under `.../subagents/`). The raw `?path=` is attacker-controlled — any
 * authenticated session can pass `?path=/etc/passwd` — and the downstream
 * reader (`ensureOpenForPath` → Rust `open` → `fs.readFile`) does NOT
 * confine it, so the gate has to live here at the request boundary.
 *
 * Returns the resolved absolute path when it is inside the store and names
 * a `.jsonl` file, or `null` to reject (the caller fails fast with 400).
 * `path.resolve` collapses any `..` traversal, so a post-resolve prefix
 * check against the projects root is sufficient — there is no symlink
 * follow here (that would require `fs.realpath`, an extra I/O the reader
 * does not perform either; confining the lexical path is the correct
 * boundary for this surface).
 */
function confineToProjectsStore(rawPath: string): string | null {
  const resolved = path.resolve(rawPath)
  // A real transcript names a `.jsonl` file strictly INSIDE the store, so
  // the prefix check is `projectsRoot + sep` (the bare root dir can never
  // be a `.jsonl` file and is correctly rejected).
  if (!resolved.endsWith('.jsonl')) return null
  const projectsRoot = path.join(homedir(), '.claude', 'projects')
  if (!resolved.startsWith(projectsRoot + path.sep)) return null
  return resolved
}

const RecordedSnapshotSchema = z.object({
  systemPrompt: z.number().int().nonnegative(),
  customAgents: z.number().int().nonnegative(),
  memory: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  autocompactBuffer: z.number().int().nonnegative(),
  freeSpace: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  modelContextLimit: z.number().int().nonnegative(),
  modelId: z.string().nullable(),
  capturedAtLineIndex: z.number().int().nonnegative(),
  capturedAtTimestamp: z.string().nullable(),
})

const BucketElementSchema = z.object({
  name: z.string(),
  tokens: z.number().int().nonnegative(),
  scope: z.enum(['user', 'project', 'plugin', 'builtin']),
  detail: z.string().optional(),
  status: z.enum(['normal', 'approx', 'missing']).optional(),
})

const ConstantBucketSchema = z.object({
  tokens: z.number().int().nonnegative(),
  note: z.string(),
})

const MessageElementsSchema = z.object({
  tokens: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
  assistantCount: z.number().int().nonnegative(),
})

const ContextElementsSchema = z.object({
  systemPrompt: ConstantBucketSchema,
  systemTools: ConstantBucketSchema,
  mcpTools: ConstantBucketSchema,
  customAgents: z.array(BucketElementSchema),
  memory: z.array(BucketElementSchema),
  skills: z.array(BucketElementSchema),
  messages: MessageElementsSchema,
  autocompactBuffer: ConstantBucketSchema,
})

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
  // Phase A — captured /context snapshot surfaced as comparison
  // overlay (UI shows Δ vs heuristic). `null` means the session has
  // no captured /context at-or-before the requested cursor.
  recordedSnapshot: RecordedSnapshotSchema.nullable().optional(),
  // Phase B — per-bucket element listings for the drill-down sub-page.
  elements: ContextElementsSchema.optional(),
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
  // The `?path=` form is caller-controlled, so it MUST be confined to the
  // Claude Code transcript store before it reaches the reader (which opens
  // it unguarded). A path outside the store is a path-traversal attempt —
  // reject it explicitly rather than letting the reader read an arbitrary
  // file. The `resolveSessionPath(sid)` fallback is server-derived (recorded
  // by `listSessionsInProjectDir`, always under `~/.claude/projects/`) and
  // needs no re-check.
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
      recordedSnapshot: resp.recordedSnapshot ?? null,
      elements: resp.elements,
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
