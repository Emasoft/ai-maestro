import path from 'path'

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasValidSession } from '@/services/sessions-browser-service'
import { componentsActiveAt } from '@/lib/pss-lifeline'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sessions-browser/lifeline?projectDir=<absolute>&atMs=<number>
 *
 * Returns, best-effort, the PSS-recorded components active in `projectDir` at conversation
 * timestamp `atMs`. Powers the chat-browser context panel's "what was loaded then" view.
 *
 * RESPONSE CONTRACT (mirrors lib/pss-lifeline.ts LifelineResult):
 *   {
 *     status: 'ok' | 'stale' | 'unavailable',
 *     reason?: string,
 *     asOfIso?: string,
 *     scanAgeSec?: number | null,
 *     components: Array<{ name: string; type: string; scope?: string; installedAtIso?: string | null }>
 *   }
 *
 * STATUS CODES:
 *   - 401 when no session cookie (consistent with the sibling sessions-browser routes).
 *   - 400 when projectDir is missing/not-absolute or atMs is missing/not-a-finite-number.
 *   - 200 in EVERY other case, including all internal failures. PSS being absent / stale /
 *     unparseable is a normal degraded state, not a server error — the panel must render.
 *     We therefore NEVER return 500 from this route; an unexpected throw is caught and mapped
 *     to a 200 { status:'unavailable' } so the chat browser is never broken by this endpoint.
 */

const LifelineComponentSchema = z.object({
  name: z.string(),
  type: z.string(),
  scope: z.string().optional(),
  installedAtIso: z.string().nullable().optional(),
})

const LifelineResultSchema = z.object({
  status: z.enum(['ok', 'stale', 'unavailable']),
  reason: z.string().optional(),
  asOfIso: z.string().optional(),
  scanAgeSec: z.number().nullable().optional(),
  components: z.array(LifelineComponentSchema),
})

export async function GET(request: Request) {
  if (!hasValidSession(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const url = new URL(request.url)
  const projectDir = url.searchParams.get('projectDir')
  const atMsStr = url.searchParams.get('atMs')

  // --- Input validation (the ONLY paths that 400) ---
  if (!projectDir || !path.isAbsolute(projectDir)) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'projectDir is required and must be an absolute path' },
      { status: 400 },
    )
  }
  if (atMsStr === null) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'atMs is required' },
      { status: 400 },
    )
  }
  const atMs = Number(atMsStr)
  if (!Number.isFinite(atMs)) {
    return NextResponse.json(
      { error: 'invalid_request', detail: 'atMs must be a finite number (epoch milliseconds)' },
      { status: 400 },
    )
  }

  // --- Query (never 500 — degrade to unavailable on any failure) ---
  try {
    const result = await componentsActiveAt(projectDir, atMs)
    // Validate our own output shape; if it somehow drifts, still return a safe 200.
    const validated = LifelineResultSchema.parse(result)
    return NextResponse.json(validated)
  } catch (err) {
    return NextResponse.json(
      {
        status: 'unavailable',
        reason: `lifeline route error: ${err instanceof Error ? err.message : String(err)}`,
        components: [],
      },
      { status: 200 },
    )
  }
}
