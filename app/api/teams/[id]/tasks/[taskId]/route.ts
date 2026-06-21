import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateTeamTask, deleteTeamTask, UpdateTaskParams } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const UpdateTaskSchema = z.object({
  subject: z.string().min(1).max(512).optional(),
  description: z.string().max(4096).optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  // status stays a free string — the registry validates it against the team's
  // columns (custom kanban or the 17 DEFAULT_STATUSES). Don't duplicate that here.
  status: z.string().max(64).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  blockedBy: z.array(z.string().uuid()).max(20).optional(),
  labels: z.array(z.string().max(64)).max(20).optional(),
  acceptanceCriteria: z.array(z.string().max(512)).max(20).optional(),
  taskType: z.string().max(32).optional(),
  externalRef: z.string().max(512).optional(),
  externalProjectRef: z.string().max(512).optional(),
  // previousStatus is a free string too (the column to restore to after blocked).
  previousStatus: z.string().max(64).optional(),
  handoffDoc: z.string().max(4096).optional(),
  prUrl: z.string().max(512).optional(),
  reviewResult: z.string().max(512).optional(),
  // TRDD-v2 alignment fields (additive, all optional) — mirror the Task schema in
  // types/task.ts so a kanban task updated via the API can carry the same
  // classification / relationship / delivery / evidence metadata a TRDD does.
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NIT']).optional(),
  effort: z.enum(['S', 'M', 'L', 'XL']).optional(),
  parentTask: z.string().uuid().optional(),
  npt: z.array(z.string().uuid()).max(50).optional(),
  eht: z.array(z.string().uuid()).max(50).optional(),
  supersedes: z.array(z.string().uuid()).max(50).optional(),
  supersededBy: z.array(z.string().uuid()).max(50).optional(),
  relevantRules: z.array(z.string().max(32)).max(50).optional(),
  releaseVia: z.enum(['publish', 'deploy', 'none']).optional(),
  implementationCommits: z.array(z.string().max(64)).max(100).optional(),
  lastTestResult: z.enum(['not-run', 'pass', 'fail', 'partial']).optional(),
  publishedVersion: z.string().max(64).optional(),
  liveSince: z.string().max(64).optional(),
  // New fields (TRDD-95d23f3b): attachments (body-encoded) + dueDate (label-encoded).
  attachments: z.array(z.object({
    url: z.string().max(2048),
    name: z.string().max(256).optional(),
    kind: z.string().max(64).optional(),
  })).max(50).optional(),
  dueDate: z.string().max(64).optional(),
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
    // TRDD-v2 classification/relationship/delivery + evidence + new fields — now carried
    // end-to-end through UpdateTaskParams → updateTeamTask → ghProject.updateTask
    // (TRDD-95d23f3b), bringing the Next.js PUT to FULL parity with the headless PUT
    // (no more dual-mode drift where dashboard edits dropped these but headless kept them).
    ...(body.severity !== undefined && { severity: body.severity }),
    ...(body.effort !== undefined && { effort: body.effort }),
    ...(body.parentTask !== undefined && { parentTask: body.parentTask }),
    ...(body.npt !== undefined && { npt: body.npt }),
    ...(body.eht !== undefined && { eht: body.eht }),
    ...(body.supersedes !== undefined && { supersedes: body.supersedes }),
    ...(body.supersededBy !== undefined && { supersededBy: body.supersededBy }),
    ...(body.relevantRules !== undefined && { relevantRules: body.relevantRules }),
    ...(body.releaseVia !== undefined && { releaseVia: body.releaseVia }),
    ...(body.implementationCommits !== undefined && { implementationCommits: body.implementationCommits }),
    ...(body.lastTestResult !== undefined && { lastTestResult: body.lastTestResult }),
    ...(body.publishedVersion !== undefined && { publishedVersion: body.publishedVersion }),
    ...(body.liveSince !== undefined && { liveSince: body.liveSince }),
    ...(body.attachments !== undefined && { attachments: body.attachments }),
    ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
    requestingAgentId,
    // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
    authContext: buildAuthContext(auth),
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

  // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
  const result = await deleteTeamTask(id, taskId, requestingAgentId, buildAuthContext(auth))
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
