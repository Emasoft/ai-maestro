import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { getTeam } from '@/lib/team-registry'
import { checkTeamAccess } from '@/lib/team-acl'
import { moveProjectItem, archiveProjectItem, configureProjectTemplate } from '@/lib/github-cli'

const UpdateKanbanItemSchema = z.object({
  status: z.string().min(1).max(64),
}).strict()

// PATCH /api/teams/[id]/kanban/items/[itemId] — Move item to new status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
  }
  // Validate itemId — GitHub project item IDs are like "PVTI_xxx", not UUIDs
  if (!itemId || typeof itemId !== 'string' || itemId.length > 100) {
    return NextResponse.json({ error: 'Invalid item ID' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })

  // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
  const access = checkTeamAccess({ teamId: id, requestingAgentId: auth.agentId, authContext: buildAuthContext(auth) })
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 })

  const team = getTeam(id)
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (!team.githubProject) {
    return NextResponse.json({ error: 'Team has no GitHub project linked' }, { status: 400 })
  }

  // Kanban write: only ORCHESTRATOR, COS, or MANAGER agents can modify. Web UI (no agentId) is allowed.
  if (auth.agentId) {
    const { isManager, isOrchestrator, isChiefOfStaff } = await import('@/lib/governance')
    const isWriteAllowed = isManager(auth.agentId) || isOrchestrator(auth.agentId, id) || isChiefOfStaff(auth.agentId, id)
    if (!isWriteAllowed) {
      return NextResponse.json({ error: 'Only ORCHESTRATOR, COS, or MANAGER can modify kanban' }, { status: 403 })
    }
  }

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = UpdateKanbanItemSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const { status } = parsed.data

    // Map short names to display names
    const statusMap: Record<string, string> = {
      'backlog': 'Backlog',
      'todo': 'To Do',
      'in_progress': 'In Progress',
      'review': 'Review',
      'done': 'Done',
    }
    const displayStatus = statusMap[status] || status

    // Get field IDs (may need to configure template first)
    const fieldIds = configureProjectTemplate(
      team.githubProject.owner,
      team.githubProject.number
    )

    moveProjectItem(
      team.githubProject.owner,
      team.githubProject.number,
      itemId,
      displayStatus,
      fieldIds
    )

    return NextResponse.json({ success: true, status: displayStatus })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to move item: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// DELETE /api/teams/[id]/kanban/items/[itemId] — Archive item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
  }
  // Validate itemId — GitHub project item IDs are like "PVTI_xxx", not UUIDs
  if (!itemId || typeof itemId !== 'string' || itemId.length > 100) {
    return NextResponse.json({ error: 'Invalid item ID' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })

  // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
  const accessDel = checkTeamAccess({ teamId: id, requestingAgentId: auth.agentId, authContext: buildAuthContext(auth) })
  if (!accessDel.allowed) return NextResponse.json({ error: accessDel.reason }, { status: 403 })

  const team = getTeam(id)
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (!team.githubProject) {
    return NextResponse.json({ error: 'Team has no GitHub project linked' }, { status: 400 })
  }

  // Kanban write: only ORCHESTRATOR, COS, or MANAGER agents can modify. Web UI (no agentId) is allowed.
  if (auth.agentId) {
    const { isManager, isOrchestrator, isChiefOfStaff } = await import('@/lib/governance')
    const isWriteAllowed = isManager(auth.agentId) || isOrchestrator(auth.agentId, id) || isChiefOfStaff(auth.agentId, id)
    if (!isWriteAllowed) {
      return NextResponse.json({ error: 'Only ORCHESTRATOR, COS, or MANAGER can modify kanban' }, { status: 403 })
    }
  }

  try {
    archiveProjectItem(
      team.githubProject.owner,
      team.githubProject.number,
      itemId
    )
    return NextResponse.json({ success: true, archived: itemId })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to archive item: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
