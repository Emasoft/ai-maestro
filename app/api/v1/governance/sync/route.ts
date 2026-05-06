/**
 * Governance Sync Endpoint (Layer 1: Cross-Host State Replication)
 *
 * POST /api/v1/governance/sync  -- Receive governance state from a peer host
 * GET  /api/v1/governance/sync  -- Return this host's governance snapshot
 *
 * Both endpoints require Ed25519 host authentication (SR-001, SR-002).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { handleGovernanceSyncMessage, buildLocalGovernanceSnapshot } from '@/lib/governance-sync'
import { getHosts, getSelfHostId } from '@/lib/hosts-config'
import { verifyHostAttestation, signHostAttestation } from '@/lib/host-keys'
import type { GovernanceSyncMessage } from '@/types/governance'

// NT-031: Module-scope Set for sync type validation (avoids per-request array allocation)
const VALID_SYNC_TYPES: ReadonlySet<string> = new Set([
  'manager-changed', 'team-updated', 'team-deleted', 'transfer-update',
])

/** POST: Receive governance sync from a peer host */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: GovernanceSyncMessage
  try { body = await request.json() as GovernanceSyncMessage } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  if (!body || !body.fromHostId || !body.type) {
    return NextResponse.json(
      { error: 'Missing required fields: fromHostId, type' },
      { status: 400 }
    )
  }

  // NT-025 (P8): Validate body.type against known GovernanceSyncType values
  if (!VALID_SYNC_TYPES.has(body.type)) {
    return NextResponse.json(
      { error: `Invalid sync type: must be one of ${[...VALID_SYNC_TYPES].join(', ')}` },
      { status: 400 }
    )
  }

  // Verify sender is a known peer host
  const hosts = getHosts()
  const knownHost = hosts.find(h => h.id === body.fromHostId)
  if (!knownHost) {
    return NextResponse.json(
      // SF-026: Do not include fromHostId in error response to avoid information disclosure
      { error: 'Unknown host' },
      { status: 403 }
    )
  }

  // Verify host signature (SR-001)
  const hostSignature = request.headers.get('X-Host-Signature')
  const hostTimestamp = request.headers.get('X-Host-Timestamp')
  const hostId = request.headers.get('X-Host-Id')
  if (!hostSignature || !hostTimestamp || !hostId) {
    return NextResponse.json({ error: 'Missing host authentication headers' }, { status: 401 })
  }
  if (hostId !== body.fromHostId) {
    return NextResponse.json({ error: 'Host ID header does not match body fromHostId' }, { status: 400 })
  }
  if (!knownHost.publicKeyHex) {
    return NextResponse.json({ error: 'Host has no registered public key' }, { status: 403 })
  }
  // SF-059: Include body hash in signed data to prevent payload tampering
  const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const signedData = `gov-sync|${hostId}|${hostTimestamp}|${bodyHash}`
  if (!verifyHostAttestation(signedData, hostSignature, knownHost.publicKeyHex)) {
    return NextResponse.json({ error: 'Invalid host signature' }, { status: 403 })
  }
  // Check timestamp freshness (5 min window, allow 60s clock skew)
  const tsAge = Date.now() - new Date(hostTimestamp).getTime()
  if (isNaN(tsAge) || tsAge > 300_000 || tsAge < -60_000) {
    return NextResponse.json({ error: 'Signature expired' }, { status: 403 })
  }

  // CC-P4-005: Use return value to detect silently dropped messages
  const accepted = await handleGovernanceSyncMessage(body.fromHostId, body)
  if (!accepted) {
    return NextResponse.json({ error: 'Message dropped: sender mismatch' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

/** GET: Return this host's full governance snapshot for peer sync requests (SR-002: requires auth) */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostId = request.headers.get('X-Host-Id')
  const hostSignature = request.headers.get('X-Host-Signature')
  const hostTimestamp = request.headers.get('X-Host-Timestamp')
  if (!hostId || !hostSignature || !hostTimestamp) {
    return NextResponse.json({ error: 'Missing host authentication headers' }, { status: 401 })
  }
  const hosts = getHosts()
  const knownHost = hosts.find(h => h.id === hostId)
  if (!knownHost) {
    return NextResponse.json({ error: 'Unknown host' }, { status: 403 })
  }
  if (!knownHost.publicKeyHex) {
    return NextResponse.json({ error: 'Host has no registered public key' }, { status: 403 })
  }
  const signedData = `gov-sync-read|${hostId}|${hostTimestamp}`
  if (!verifyHostAttestation(signedData, hostSignature, knownHost.publicKeyHex)) {
    return NextResponse.json({ error: 'Invalid host signature' }, { status: 403 })
  }
  // Check timestamp freshness (5 min window, allow 60s clock skew)
  const tsAge = Date.now() - new Date(hostTimestamp).getTime()
  if (isNaN(tsAge) || tsAge > 300_000 || tsAge < -60_000) {
    return NextResponse.json({ error: 'Signature expired' }, { status: 403 })
  }
  const snapshot = buildLocalGovernanceSnapshot()
  const responseBody = { ...snapshot, lastSyncAt: new Date().toISOString(), ttl: 300 }

  // LIB2-MAJ-09: Sign the response body with this host's Ed25519 key so the
  // requesting peer can verify authenticity (defends against a compromised
  // peer or MITM that returns a forged governance snapshot). The peer
  // verifies via verifyHostAttestation() using the host's publicKeyHex from
  // its hosts-config registry.
  const responseTimestamp = new Date().toISOString()
  const responseHostId = getSelfHostId()
  // Canonical signing input: combines response body hash + timestamp + hostId
  // so a replay against a different host cannot succeed.
  const bodyHash = createHash('sha256').update(JSON.stringify(responseBody)).digest('hex')
  const respSignedData = `gov-sync-resp|${responseHostId}|${responseTimestamp}|${bodyHash}`
  const responseSignature = signHostAttestation(respSignedData)

  return NextResponse.json(responseBody, {
    headers: {
      'X-Host-Id': responseHostId,
      'X-Host-Timestamp': responseTimestamp,
      'X-Host-Signature': responseSignature,
    },
  })
}
