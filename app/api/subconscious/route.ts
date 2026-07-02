import { NextRequest, NextResponse } from 'next/server'
import { getSubconsciousStatus } from '@/services/config-service'
import { requireAuth } from '@/lib/route-auth'

// Force dynamic rendering - agent count changes at runtime
export const dynamic = 'force-dynamic'

/**
 * GET /api/subconscious
 * Get the global subconscious status across all agents.
 * Reads from status FILES instead of loading agents into memory.
 */
export async function GET(request: NextRequest) {
  // N5: this returned aggregate subconscious runtime telemetry across all
  // agents with NO auth. Require authentication; any authenticated caller may
  // read the global status.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const result = getSubconsciousStatus()

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Subconscious GET] error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
