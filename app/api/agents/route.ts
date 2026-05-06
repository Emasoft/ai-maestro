import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listAgents, searchAgentsByQuery } from '@/services/agents-core-service'
import { CreateAgent } from '@/services/element-management-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_@.-]+$/, 'Agent name must be alphanumeric with _@.-'),
  label: z.string().max(128).optional(),
  client: z.string().max(32).optional(),
  program: z.string().max(32).optional(),
  workingDirectory: z.string().max(512).optional(),
  governanceTitle: z.string().max(32).optional(),
  teamId: z.string().uuid().optional(),
  avatar: z.string().max(512).optional(),
  programArgs: z.string().max(2048).optional(),
  pluginName: z.string().max(128).optional(),
  createSession: z.boolean().optional(),
  owner: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  model: z.string().max(64).optional(),
  taskDescription: z.string().max(1024).optional(),
  githubRepo: z.string().max(256).regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Must be owner/repo format').optional(),
}).strict()

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
