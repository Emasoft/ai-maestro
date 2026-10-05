/**
 * Creation Helper Response API
 *
 * GET /api/agents/creation-helper/response - Capture Claude's latest response
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { captureResponse } from '@/services/creation-helper-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Owner's wizard: its chat and raw-materials are already owner-only, so its captured output is too.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const result = await captureResponse()
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[CreationHelper] GET response error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
