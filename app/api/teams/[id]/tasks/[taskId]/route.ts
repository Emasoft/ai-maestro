import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateTeamTask, deleteTeamTask, UpdateTaskParams } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const UpdateTaskSchema = z.object({
  subject: z.string().min(1).max(512).optional(),
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
  previousStatus: z.string().max(32).optional(),
  handoffDoc: z.string().max(4096).optional(),
  prUrl: z.string().max(512).optional(),
  reviewResult: z.string().max(512).optional(),
}).strict()

// PUT /api/teams/[id]/tasks/[taskId] - Update a task
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  // taskId can be a UUID (local storage) or a GitHub Project item node_id (PVTI_...)
  if (!taskId || taskId.length > 200) {
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 })
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

  const parsed = UpdateTaskSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Whitelist only known UpdateTaskParams fields to avoid passing arbitrary data
  const safeParams: UpdateTaskParams = {
    ...(body.subject !== undefined && { subject: body.subject }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.status !== undefined && { status: body.status }),
    ...(body.priority !== undefined && { priority: body.priority }),
    ...(body.assigneeAgentId !== undefined && { assigneeAgentId: body.assigneeAgentId }),
    ...(body.blockedBy !== undefined && { blockedBy: body.blockedBy }),
    ...(body.labels !== undefined && { labels: body.labels }),
    ...(body.taskType !== undefined && { taskType: body.taskType }),
    ...(body.externalRef !== undefined && { externalRef: body.externalRef }),
    ...(body.externalProjectRef !== undefined && { externalProjectRef: body.externalProjectRef }),
    ...(body.previousStatus !== undefined && { previousStatus: body.previousStatus }),
    ...(body.acceptanceCriteria !== undefined && { acceptanceCriteria: body.acceptanceCriteria }),
    ...(body.handoffDoc !== undefined && { handoffDoc: body.handoffDoc }),
    ...(body.prUrl !== undefined && { prUrl: body.prUrl }),
    ...(body.reviewResult !== undefined && { reviewResult: body.reviewResult }),
    requestingAgentId,
  }

  const result = await updateTeamTask(id, taskId, safeParams)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// DELETE /api/teams/[id]/tasks/[taskId] - Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { id, taskId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  // taskId can be a UUID (local storage) or a GitHub Project item node_id (PVTI_...)
  if (!taskId || taskId.length > 200) {
    return NextResponse.json({ error: 'Invalid task ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  const result = await deleteTeamTask(id, taskId, requestingAgentId)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
