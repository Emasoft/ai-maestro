/**
 * AMP v1 Health Check Endpoint
 *
 * GET /api/v1/health
 *
 * Returns provider health status and basic metrics.
 * No authentication required - used for monitoring and load balancers.
 */

// NT-010: Simplified import — NextRequest not needed since _request param is unused for Next.js-specific features
import { NextResponse } from 'next/server'
import { getHealthStatus } from '@/services/amp-service'
import type { AMPHealthResponse } from '@/lib/types/amp'

// A LIVENESS endpoint must never be answered from a cache. Next.js full-route-caches a handler
// that never reads its Request, and this one deliberately does not (`_request` is unused) — so
// being unauthenticated and request-independent, the two properties that make this endpoint useful
// to a federation peer, are exactly what made it static. Measured 2026-08-02: `x-nextjs-cache: HIT`
// on every call, with `uptime_seconds` frozen at 3 across polls while the process had been up
// 274775s, and `agents_online` frozen at 0.
//
// `cache-control: no-cache, no-store, must-revalidate` was already set and did NOT prevent it:
// that header instructs the CLIENT, while the full route cache lives server-side. A response that
// tells the caller not to cache it, and is itself served from cache, is the worst of both.
//
// The failure is silent and the wrong way round: a peer polling "is that host alive?" gets a
// cached `status: "healthy"` indefinitely — including after the host degrades. A liveness probe
// that cannot report anything but healthy is worse than no probe, because it is trusted.
export const dynamic = 'force-dynamic'

// NT-013: Prefix unused request parameter with underscore
export async function GET(_request: Request): Promise<NextResponse<AMPHealthResponse | { error: string }>> {
  const result = getHealthStatus()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  // SF-015: Guard against missing data — return error instead of empty object
  if (!result.data) {
    return NextResponse.json({ error: 'Health data unavailable' }, { status: 500 })
  }
  return NextResponse.json(result.data, {
    status: result.status,
    headers: result.headers
  })
}
