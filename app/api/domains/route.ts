import { NextRequest, NextResponse } from 'next/server'
import { listAllDomains, createNewDomain } from '@/services/domains-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

// Force dynamic -- reads runtime filesystem state
export const dynamic = 'force-dynamic'

/**
 * GET /api/domains
 * List all email domains
 */
export async function GET() {
  try {
    const result = listAllDomains()

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Domains] GET list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/domains
 * Create a new email domain
 */
export async function POST(request: NextRequest) {
  // Authenticate -- domain creation is a write path (MF-003 pattern)
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = createNewDomain(body)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Domains] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
