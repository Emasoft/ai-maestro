/**
 * AMP v1 Pending Messages Endpoint
 *
 * GET /api/v1/messages/pending?limit=10
 * DELETE /api/v1/messages/pending?id=<messageId>
 * POST /api/v1/messages/pending (batch ack)
 *
 * Thin wrapper - business logic in services/amp-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listPendingMessages, acknowledgePendingMessage, batchAcknowledgeMessages } from '@/services/amp-service'
import type { AMPError, AMPPendingMessagesResponse } from '@/lib/types/amp'

// API2-MAJ-21: Zod-validate the batch acknowledge body. Cap at 100 IDs and
// 256 chars each so a malformed/oversized array can't escape into the
// service layer.
const BatchAckSchema = z.object({
  ids: z.array(z.string().min(1).max(256)).min(1).max(100),
}).strict()

// Cap the GET pagination limit so a caller can't request a huge batch
// (memory-DoS vector noted in MIN-04 / MAJ-21).
const MAX_PENDING_LIMIT = 200

// NT-011: AMPError requires both `error` (code) and `message` (human-readable) fields.
// When a service returns only an error string, we populate both fields with the same value.
// This is intentional to satisfy the AMPError type contract without losing information.
function ampError(error: string, status: number): NextResponse<AMPError> {
  return NextResponse.json({ error, message: error } as AMPError, { status })
}

export async function GET(request: NextRequest): Promise<NextResponse<AMPPendingMessagesResponse | AMPError>> {
  const authHeader = request.headers.get('Authorization')
  // CC-P4-009: Use request.nextUrl.searchParams instead of new URL(request.url) for consistency
  const searchParams = request.nextUrl.searchParams
  const limitParam = searchParams.get('limit')
  // CC-P3-005: NaN guard — discard non-numeric limit values
  const parsed = limitParam ? parseInt(limitParam, 10) : NaN
  // API2-MAJ-21: cap at MAX_PENDING_LIMIT so the caller can't pull
  // unbounded amounts of data through pagination.
  const limit = Number.isNaN(parsed) || parsed < 1
    ? undefined
    : Math.min(parsed, MAX_PENDING_LIMIT)

  const result = listPendingMessages(authHeader, limit)
  if (result.error) {
    return ampError(result.error, result.status)
  }
  // SF-012: Use nullish coalescing instead of non-null assertion to avoid passing undefined
  return NextResponse.json((result.data ?? {}) as AMPPendingMessagesResponse, {
    status: result.status,
    headers: result.headers
  })
}

export async function DELETE(request: NextRequest): Promise<NextResponse<{ acknowledged: boolean } | AMPError>> {
  const authHeader = request.headers.get('Authorization')
  const searchParams = request.nextUrl.searchParams
  const messageId = searchParams.get('id')

  const result = acknowledgePendingMessage(authHeader, messageId)
  if (result.error) {
    return ampError(result.error, result.status)
  }
  // SF-012: Use nullish coalescing instead of non-null assertion to avoid passing undefined
  return NextResponse.json((result.data ?? {}) as { acknowledged: boolean }, { status: result.status })
}

export async function POST(request: NextRequest): Promise<NextResponse<{ acknowledged: number } | AMPError>> {
  const authHeader = request.headers.get('Authorization')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({
      error: 'invalid_request',
      message: 'Invalid JSON body'
    } as AMPError, { status: 400 })
  }

  // API2-MAJ-21: validate the body shape before forwarding to the service.
  const parsedBody = BatchAckSchema.safeParse(raw)
  if (!parsedBody.success) {
    return NextResponse.json({
      error: 'invalid_request',
      message: 'ids must be a non-empty array of strings (max 100, each ≤256 chars)'
    } as AMPError, { status: 400 })
  }

  const result = batchAcknowledgeMessages(authHeader, parsedBody.data.ids)
  if (result.error) {
    return ampError(result.error, result.status)
  }
  // SF-012: Use nullish coalescing instead of non-null assertion to avoid passing undefined
  return NextResponse.json((result.data ?? {}) as { acknowledged: number }, { status: result.status })
}
