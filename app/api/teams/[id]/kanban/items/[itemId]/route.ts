import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { getTeam } from '@/lib/team-registry'
import { checkTeamAccess } from '@/lib/team-acl'
import { moveProjectItem, archiveProjectItem, configureProjectTemplate } from '@/lib/github-cli'
import { DEFAULT_KANBAN_COLUMNS } from '@/types/team'

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

    // Resolve the GitHub Project's Status label from the CANONICAL column id.
    //
    // This used to be a hand-rolled 5-entry map (backlog/todo/in_progress/review/done) with an
    // `|| status` fallthrough — a legacy vocabulary that predates the ratified column vocabulary. It was
    // wrong in both directions: it ACCEPTED four ids that are not statuses at all, and for 16 of
    // the 17 real ids it fell through and sent GitHub the raw id ("human_review") instead of the
    // Status option's label ("Human Review"), so the mirror silently drifted from the board. Only
    // `todo` happened to map correctly. The kanban overlay is explicit that consumers — GitHub
    // Project mirrors included — align TO the 22-column vocabulary, never the reverse.
    //
    // The team's own `kanbanConfig` wins when set (a custom board defines its own ids AND labels,
    // exactly as `validStatusesForTeam` accepts only that team's ids); otherwise the 22 defaults.
    const columns = team.kanbanConfig ?? DEFAULT_KANBAN_COLUMNS
    const column = columns.find(c => c.id === status)
    if (!column) {
      // Reject rather than fall through. A pass-through would move the item to a Status option
      // that does not exist on the project, which fails deep inside `gh` (or worse, succeeds
      // against a same-named option) with nothing naming the real cause.
      return NextResponse.json(
        {
          error: `Unknown kanban column "${status}" for this team. Valid: ${columns.map(c => c.id).join(', ')}`,
        },
        { status: 400 },
      )
    }
    const displayStatus = column.label

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
