import { NextRequest, NextResponse } from 'next/server'
import { getOrganization, setOrganizationName } from '@/services/config-service'
import { enforceSystemOwner } from '@/lib/route-auth'

/**
 * GET /api/organization
 * Returns the current organization configuration.
 */
export async function GET() {
  const result = getOrganization()
  // MF-006: Error guard to prevent returning undefined data on failure
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
  }
  return NextResponse.json(result.data, { status: result.status })
}

/**
 * POST /api/organization
 * Set the organization name. Can only be done once.
 * Body: { organization: string, setBy?: string }
 */
export async function POST(request: NextRequest) {
  // One-time org naming is host-level config → system owner only.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { organization, setBy } = body

    if (!organization || typeof organization !== 'string') {
      return NextResponse.json({ error: 'organization is required and must be a string' }, { status: 400 })
    }
    if (setBy !== undefined && typeof setBy !== 'string') {
      return NextResponse.json({ error: 'setBy must be a string if provided' }, { status: 400 })
    }

    const result = setOrganizationName({ organization, setBy })
    // SF-011 fix: Use explicit error check instead of ?? which can swallow errors
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Organization API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
