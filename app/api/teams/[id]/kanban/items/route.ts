import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { getTeam } from '@/lib/team-registry'
import { checkTeamAccess } from '@/lib/team-acl'
import { addProjectItem, listProjectItems, createIssue, linkIssueToProject } from '@/lib/github-cli'

const CreateKanbanItemSchema = z.object({
  title: z.string().min(1).max(512),
  repo: z.string().max(256).optional(),
  assignee: z.string().max(128).optional(),
  labels: z.string().max(512).optional(),
}).strict()

// GET /api/teams/[id]/kanban/items — List kanban items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
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

  try {
    const status = request.nextUrl.searchParams.get('status') || undefined
    const assignee = request.nextUrl.searchParams.get('assignee') || undefined
    let items = listProjectItems(team.githubProject.owner, team.githubProject.number)

    // Apply filters
    if (status) items = items.filter(i => i.status?.toLowerCase() === status.toLowerCase())
    if (assignee) items = items.filter(i => i.assignee === assignee)

    return NextResponse.json({ items })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to list items: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// POST /api/teams/[id]/kanban/items — Create a kanban item (issue + project card)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
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

    const parsed = CreateKanbanItemSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const { title, repo, assignee, labels } = parsed.data

    // Default repo from project owner
    const targetRepo = repo || `${team.githubProject.owner}/${team.githubProject.repo}`
    // Validate targetRepo format — must be "owner/name" with no shell metacharacters
    if (!targetRepo || !targetRepo.includes('/') || /[;&|`$(){}!#'"\\<>*?\[\]\n\r~]/.test(targetRepo)) {
      return NextResponse.json({ error: 'Invalid repo format (expected owner/name)' }, { status: 400 })
    }
    const [owner, repoName] = targetRepo.split('/')

    // Create issue
    const labelsList = labels ? labels.split(',').map((l: string) => l.trim()) : ['ai-maestro-task']
    const issue = createIssue(owner, repoName, title, `Assigned to: ${assignee || 'unassigned'}`, labelsList)

    // Link to project
    const itemId = linkIssueToProject(team.githubProject.owner, team.githubProject.number, issue.url)

    return NextResponse.json({ issue, itemId })
  } catch (error) {
    // API2-MIN-01 / API2-MIN-11: log full error server-side, return generic message to client
    console.error('[kanban-items-create]', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'kanban-items-create' },
      { status: 500 }
    )
  }
}
