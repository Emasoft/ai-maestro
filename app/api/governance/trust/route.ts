/**
 * Manager Trust CRUD Endpoints (Full-mode Next.js routes)
 *
 * GET  /api/governance/trust         -- List all trusted managers
 * POST /api/governance/trust         -- Add a trusted manager (requires governance password)
 *
 * Mirrors the headless-router handlers at services/headless-router.ts:1366-1371
 * Business logic in services/governance-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { listTrustedManagers, addTrust } from '@/services/governance-service'
import { enforceSystemOwner } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

/** GET: List all trusted managers */
export async function GET() {
  try {
    const result = listTrustedManagers()
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[governance-trust-list]', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'governance-trust-list' },
      { status: 500 }
    )
  }
}

/** POST: Add a trusted manager (requires governance password) */
export async function POST(request: NextRequest) {
  // Trust changes affect cross-host governance and MUST be the
  // logged-in user's decision alone — agents cannot extend trust.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await addTrust(body)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[governance-trust-add]', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'governance-trust-add' },
      { status: 500 }
    )
  }
}
