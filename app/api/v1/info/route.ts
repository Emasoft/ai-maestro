/**
 * AMP v1 Provider Info Endpoint
 *
 * GET /api/v1/info
 *
 * Returns provider information including capabilities, registration modes,
 * and rate limits. No authentication required.
 */

// NT-010: Simplified import — NextRequest not needed since _request param is unused for Next.js-specific features
import { NextResponse } from 'next/server'

// Same defect as /api/v1/health (fixed in 06452c06), found by sweeping for the SHAPE rather than
// the instance: a GET handler that never reads its Request is treated as static by Next.js and
// full-route-cached. Being unauthenticated and request-independent is what makes an AMP discovery
// endpoint useful to a peer, and it is also exactly what made it static — measured
// `x-nextjs-cache: HIT` on the live server.
//
// Here the frozen value is generated at BUILD time, which is worse than it first looks:
// `provider` comes from getOrganization() → an fs read of the hosts config at request time
// (lib/hosts-config.ts), and `registration_modes` is likewise runtime policy. Cached, they are
// whatever the config said on the machine that ran `yarn build`. So changing the organization
// leaves every federation peer discovering the OLD provider domain until someone happens to
// rebuild — a config change that silently does not propagate.
//
// `capabilities` is the field ai-maestro#88 proposes the fleet use to answer "is verb X live?".
// A cached capability set answers "what was live when this was built", which is the precise
// question #88 exists to stop people guessing at.
export const dynamic = 'force-dynamic'
import { getProviderInfo } from '@/services/amp-service'
import type { AMPInfoResponse } from '@/lib/types/amp'

// NT-013: Prefix unused request parameter with underscore
export async function GET(_request: Request): Promise<NextResponse<AMPInfoResponse | { error: string }>> {
  const result = getProviderInfo()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  // Guard against null/undefined data -- service should always return data on success
  if (!result.data) {
    return NextResponse.json({ error: 'Provider info unavailable' }, { status: 500 })
  }
  return NextResponse.json(result.data as AMPInfoResponse, {
    status: result.status,
    headers: result.headers
  })
}
