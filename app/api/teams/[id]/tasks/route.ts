import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listTeamTasks, createTeamTask, CreateTaskParams } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const CreateTaskSchema = z.object({
  subject: z.string().min(1).max(512),
  description: z.string().max(4096).optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  status: z.string().max(32).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  blockedBy: z.array(z.string().uuid()).max(20).optional(),
  labels: z.array(z.string().max(64)).max(20).optional(),
  acceptanceCriteria: z.array(z.string().max(512)).max(20).optional(),
  taskType: z.string().max(32).optional(),
  externalRef: z.string().max(512).optional(),
  externalProjectRef: z.string().max(512).optional(),
  handoffDoc: z.string().max(4096).optional(),
  prUrl: z.string().max(512).optional(),
}).strict()

// GET /api/teams/[id]/tasks - List tasks with resolved dependencies
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  // Extract optional query filters
  const url = new URL(request.url)
  const filters: { assignee?: string; status?: string; label?: string; taskType?: string } = {}
  if (url.searchParams.has('assignee')) filters.assignee = url.searchParams.get('assignee')!
  if (url.searchParams.has('status')) filters.status = url.searchParams.get('status')!
  if (url.searchParams.has('label')) filters.label = url.searchParams.get('label')!
  if (url.searchParams.has('taskType')) filters.taskType = url.searchParams.get('taskType')!

  const hasFilters = Object.keys(filters).length > 0
  const result = await listTeamTasks(id, requestingAgentId, hasFilters ? filters : undefined)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// POST /api/teams/[id]/tasks - Create a new task
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateTaskSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Whitelist only known CreateTaskParams fields to avoid passing arbitrary data
  const safeParams: CreateTaskParams = {
    subject: body.subject,
    ...(body.description !== undefined && { description: body.description }),
    ...(body.assigneeAgentId !== undefined && { assigneeAgentId: body.assigneeAgentId }),
    ...(body.blockedBy !== undefined && { blockedBy: body.blockedBy }),
    ...(body.priority !== undefined && { priority: body.priority }),
    ...(body.status !== undefined && { status: body.status }),
    ...(body.labels !== undefined && { labels: body.labels }),
    ...(body.taskType !== undefined && { taskType: body.taskType }),
    ...(body.externalRef !== undefined && { externalRef: body.externalRef }),
    ...(body.externalProjectRef !== undefined && { externalProjectRef: body.externalProjectRef }),
    ...(body.acceptanceCriteria !== undefined && { acceptanceCriteria: body.acceptanceCriteria }),
    ...(body.handoffDoc !== undefined && { handoffDoc: body.handoffDoc }),
    ...(body.prUrl !== undefined && { prUrl: body.prUrl }),
    requestingAgentId,
  }
  const result = await createTeamTask(id, safeParams)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
