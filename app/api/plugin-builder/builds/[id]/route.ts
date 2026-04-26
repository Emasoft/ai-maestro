/**
 * Plugin Builder - Build Status API
 *
 * GET /api/plugin-builder/builds/:id - Check build status
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getBuildStatus } from '@/services/plugin-builder-service'
import { isValidUuid } from '@/lib/validation'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  // Reject malformed build IDs before hitting the service layer
  if (!id || !isValidUuid(id)) {
    return NextResponse.json(
      { error: 'Invalid build ID' },
      { status: 400 }
    )
  }

  try {
    const result = await getBuildStatus(id)

    if (result.error) {
      // Guard against service returning an invalid or missing HTTP status code
      const statusCode =
        typeof result.status === 'number' && result.status >= 100 && result.status < 600
          ? result.status
          : 500
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Error getting build status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
