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
import { authenticateFromRequest } from '@/lib/agent-auth'
import { getSelfHostId, isSelf } from '@/lib/hosts-config'
import { internalError } from '@/lib/error-response'

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
    return internalError(error, 'mesh-humans-get')
  }
}

// POST /api/v1/mesh/humans
export async function POST(request: NextRequest) {
  // API2-MAJ-09: full token verification + reject any upsert that claims a
  // hostId other than this machine's. Cross-host directory sync requires
  // an attested federated path, not this endpoint.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  // Only system-owner (web user) should be able to upsert human entries.
  // Agents can read but should not be able to claim a human identity.
  if (auth.agentId) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Only the system owner can upsert human directory entries' },
      { status: 403 },
    )
  }

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

    // Refuse to upsert a human entry whose hostId points elsewhere — only
    // the local entry can be modified through this endpoint.
    if (!isSelf(parsed.data.hostId)) {
      return NextResponse.json(
        { error: 'host_mismatch', message: 'Can only upsert entries for the local host' },
        { status: 403 },
      )
    }
    // Pin to the canonical local hostId regardless of body case.
    const verified = { ...parsed.data, hostId: getSelfHostId() }

    upsertHuman(verified)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    return internalError(error, 'mesh-humans-post')
  }
}
