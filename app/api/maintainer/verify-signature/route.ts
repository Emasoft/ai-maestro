/**
 * POST /api/maintainer/verify-signature
 *
 * Zero-trust HMAC verification endpoint (R19.6). The MAINTAINER agent
 * calls this with the raw webhook payload + X-Hub-Signature-256 header.
 * The server loads the secret (never sent to the agent), computes the
 * HMAC, and returns only { valid: true/false }.
 *
 * Even if the agent's working directory is compromised, the webhook
 * secret stays safe — it never leaves this process.
 */

import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/maintainer-secrets'

export async function POST(request: Request): Promise<NextResponse> {
  let body: { agentId?: string; signature?: string; rawBody?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { agentId, signature, rawBody } = body

  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid agentId' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid signature' }, { status: 400 })
  }
  if (!rawBody || typeof rawBody !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid rawBody' }, { status: 400 })
  }

  const valid = verifyWebhookSignature(agentId, signature, rawBody)
  return NextResponse.json({ valid })
}
