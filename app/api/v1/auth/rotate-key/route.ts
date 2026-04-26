/**
 * AMP v1 API Key Rotation
 *
 * POST /api/v1/auth/rotate-key
 *
 * Thin wrapper - business logic in services/amp-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { rotateKey } from '@/services/amp-service'
import type { AMPError } from '@/lib/types/amp'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    const result = await rotateKey(authHeader)
    if (result.error) {
      return NextResponse.json({ error: result.error } as AMPError, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[rotate-key] Unhandled error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: error instanceof Error ? error.message : 'Internal server error' } as AMPError,
      { status: 500 }
    )
  }
}
