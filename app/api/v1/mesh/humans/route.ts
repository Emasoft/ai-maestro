/**
 * GET  /api/v1/mesh/humans — Returns the local humans directory.
 * POST /api/v1/mesh/humans — Upserts a human entry (mesh peer sync).
 *
 * Both endpoints are behind Tailscale IP filter (isAllowedSource in server.mjs).
 * POST requires authentication.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadHumans, upsertHuman } from '@/lib/human-directory'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

const UpsertHumanSchema = z.object({
  id: z.string().min(1).max(256),
  hostId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(128),
  tailscaleIp: z.string().min(7).max(45), // shortest valid IP: 0.0.0.0
  lastSeen: z.string().min(1).max(64),
  status: z.enum(['online', 'offline', 'away']),
  avatar: z.string().max(512).optional(),
  publicKey: z.string().max(1024).optional(),
  createdAt: z.string().max(64).optional(),
}).strict()

// GET /api/v1/mesh/humans
export async function GET() {
  try {
    const humans = loadHumans()
    return NextResponse.json({ version: 1, humans }, { status: 200 })
  } catch (error) {
    console.error('[mesh/humans] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to load humans directory: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}

// POST /api/v1/mesh/humans
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = UpsertHumanSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    upsertHuman(parsed.data)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error('[mesh/humans] POST failed:', error)
    return NextResponse.json(
      { error: `Failed to upsert human: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}
