import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { getAgentById } from '@/services/agents-core-service'
import { readPendingPrompt } from '@/services/sessions-service'

// GET /api/agents/[id]/prompt — the pending permission/question prompt for ONE
// agent, as { prompt: <PendingPrompt> | null }. Read-only ⇒ non-strict.
//
// Like GET /api/agents/[id]/full, this is a fleet-MONITOR surface: any
// authenticated caller may read ANY agent's pending prompt, so a governance
// agent (the janitor, a MANAGER) can see what a stuck agent is asking and then
// answer it. It exposes only the same prompt text/options the agent's own
// terminal already shows — no secret beyond what's on the pane.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  const result = getAgentById(id)
  if (result.error || !result.data) {
    return NextResponse.json(
      { error: result.error || 'Agent not found' },
      { status: result.status || 404 },
    )
  }

  const agent = result.data.agent
  const prompt = agent.workingDirectory ? readPendingPrompt(agent.workingDirectory) : null
  return NextResponse.json({ prompt })
}
