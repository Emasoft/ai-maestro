import { NextRequest, NextResponse } from 'next/server'
import { listAgents, searchAgentsByQuery } from '@/services/agents-core-service'
import { CreateAgent } from '@/services/element-management-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'
// Schema extracted to lib/ (TRDD-57EBNB72): Next.js route modules may only
// export HTTP verbs/config, and the schema must be directly testable.
import { CreateAgentSchema } from '@/lib/create-agent-schema'

// Force this route to be dynamic (not statically generated at build time)
export const dynamic = 'force-dynamic'

/**
 * GET /api/agents
 * Returns all agents registered on THIS host with their live session status.
 *
 * Query params:
 *   - q: Search query (searches name, label, taskDescription, tags)
 */
export async function GET(request: NextRequest) {
  try {
    // CC-GOV-008: Auth required to prevent metadata leaks via Tailscale
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    // CC-P2-009: Check for search errors before returning results
    if (query) {
      const result = await searchAgentsByQuery(query)
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json(result.data, { status: result.status })
    }

    const result = await listAgents()
    if (result.error) {
      return NextResponse.json(
        { error: result.error, agents: [] },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MIN-01: log full error server-side, return generic 500.
    return internalError(error, 'agents-list')
  }
}

/**
 * POST /api/agents
 * Create a new agent
 */
export async function POST(request: NextRequest) {
  try {
    // CC-GOV-008: Auth required — agent creation is a privileged mutation
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = CreateAgentSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const body = parsed.data

    const result = await CreateAgent({
      ...body,
      authContext: buildAuthContext(auth),
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Return the created agent (match old response format)
    const { getAgent } = await import('@/lib/agent-registry')
    const agent = result.agentId ? getAgent(result.agentId) : null
    return NextResponse.json({ agent }, { status: 201 })
  } catch (error) {
    return internalError(error, 'agents-create')
  }
}
