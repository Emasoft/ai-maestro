/**
 * AMP v1 Registration Endpoint
 *
 * POST /api/v1/register
 *
 * Registers a new agent with the local AMP provider.
 * Thin wrapper - business logic in services/amp-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registerAgent } from '@/services/amp-service'
import { checkAndRecordAttempt } from '@/lib/rate-limit'
import type { AMPRegistrationRequest, AMPRegistrationResponse, AMPError, AMPNameTakenError } from '@/lib/types/amp'

// API2-MAJ-11: Zod schema mirroring AMPRegistrationRequest with bounds and
// .strict() on the outer shape. Inner sub-objects are intentionally
// non-strict to avoid breaking callers that pass extra delivery/metadata
// fields the service ignores.
const RegistrationSchema = z.object({
  tenant: z.string().min(1).max(128),
  name: z.string().min(1).max(63),
  public_key: z.string().min(1).max(8192),
  key_algorithm: z.enum(['Ed25519', 'RSA', 'ECDSA']),
  alias: z.string().min(1).max(128).optional(),
  scope: z.object({
    platform: z.string().max(128).optional(),
    repo: z.string().max(256).optional(),
  }).optional(),
  delivery: z.object({
    webhook_url: z.string().max(2048).optional(),
    webhook_secret: z.string().max(512).optional(),
    prefer_websocket: z.boolean().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  invite_code: z.string().max(256).optional(),
}).strict()

export async function POST(request: NextRequest): Promise<NextResponse<AMPRegistrationResponse | AMPError | AMPNameTakenError>> {
  try {
    // API2-MAJ-11: rate limit by source IP. The endpoint is whitelisted in
    // middleware (so it's reachable without credentials) — without a rate
    // limit an attacker could flood the AMP keystore.
    const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const ipCheck = checkAndRecordAttempt(`amp-register:${sourceIp}`, 5)
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many registration attempts. Try again later.' } as AMPError,
        { status: 429 }
      )
    }
    const globalCheck = checkAndRecordAttempt('amp-register:global', 60)
    if (!globalCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many registration attempts. Try again later.' } as AMPError,
        { status: 429 }
      )
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_request', message: 'Invalid JSON body' } as AMPError, { status: 400 })
    }

    const parsed = RegistrationSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Validation failed' } as AMPError,
        { status: 400 }
      )
    }
    const body = parsed.data as AMPRegistrationRequest

    const authHeader = request.headers.get('Authorization')

    const result = await registerAgent(body, authHeader)
    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.error } as AMPError, { status: result.status })
    }
    // Guard against null/undefined data -- service should always return data on success
    if (!result.data) {
      return NextResponse.json({ error: 'internal_error', message: 'Registration response missing' } as AMPError, { status: 500 })
    }
    return NextResponse.json(result.data as AMPRegistrationResponse, { status: result.status })
  } catch (error) {
    // MIN-01: log full error server-side, return generic 500.
    console.error('[v1/register]', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'Internal server error' } as AMPError,
      { status: 500 }
    )
  }
}
