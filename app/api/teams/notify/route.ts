import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyTeamAgents } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

const NotifyTeamSchema = z.object({
  agentIds: z.array(z.string().uuid()).min(1).max(50),
  teamName: z.string().min(1).max(128),
}).strict()

// NT-008 fix: Force dynamic rendering for consistency with other POST-only routes
export const dynamic = 'force-dynamic'

// POST /api/teams/notify - Notify team agents about a meeting
export async function POST(request: NextRequest) {
  // Authenticate requesting agent identity (CC-P1-304)
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = NotifyTeamSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  const result = await notifyTeamAgents(parsed.data)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
