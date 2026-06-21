import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listTeamTasks, createTeamTask, CreateTaskParams } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const CreateTaskSchema = z.object({
  subject: z.string().min(1).max(512),
  description: z.string().max(4096).optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  // status stays a free string — the registry validates it against the team's
  // columns (custom kanban or the 17 DEFAULT_STATUSES). Don't duplicate that here.
  status: z.string().max(64).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  // F3 fix: relationship ids are NOT UUIDs. The only live persistence path is
  // GitHub Projects, where a task id is a `PVTI_…` node id, and these fields mirror
  // TRDD frontmatter whose refs are `TRDD-<8hex>` — neither passes z.string().uuid(),
  // so a real payload was rejected 400 by this route while headless accepted it.
  // Use the same bounded-string rule this route already applies to the path taskId
  // (length <= 200). Array `.max()` bounds are preserved.
  blockedBy: z.array(z.string().min(1).max(200)).max(20).optional(),
  labels: z.array(z.string().max(64)).max(20).optional(),
  acceptanceCriteria: z.array(z.string().max(512)).max(20).optional(),
  taskType: z.string().max(32).optional(),
  externalRef: z.string().max(512).optional(),
  externalProjectRef: z.string().max(512).optional(),
  handoffDoc: z.string().max(4096).optional(),
  prUrl: z.string().max(512).optional(),
  reviewResult: z.string().max(512).optional(),
  // TRDD-v2 alignment fields (additive, all optional) — mirror the Task schema in
  // types/task.ts so a kanban task created via the API can carry the same
  // classification / relationship / delivery / evidence metadata a TRDD does.
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NIT']).optional(),
  effort: z.enum(['S', 'M', 'L', 'XL']).optional(),
  // F3 fix: see blockedBy above — relationship ids are GitHub `PVTI_…` node ids /
  // `TRDD-<8hex>` refs, not UUIDs, so z.string().uuid() rejected real payloads 400.
  parentTask: z.string().min(1).max(200).optional(),
  npt: z.array(z.string().min(1).max(200)).max(50).optional(),
  eht: z.array(z.string().min(1).max(200)).max(50).optional(),
  supersedes: z.array(z.string().min(1).max(200)).max(50).optional(),
  supersededBy: z.array(z.string().min(1).max(200)).max(50).optional(),
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
  // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
  const result = await listTeamTasks(id, requestingAgentId, hasFilters ? filters : undefined, buildAuthContext(auth))

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
    // TRDD-v2 alignment fields — forward the 8 that CreateTaskParams,
    // createTeamTask, and ghProject.createTask (trddMetadataLabels) support
    // end-to-end, matching the headless-router mirror
    // (services/headless-router.ts:2099-2106). Without this spread the Next.js
    // route VALIDATED these via CreateTaskSchema but dropped them before
    // createTeamTask, so a kanban task created in FULL (Next.js) mode silently
    // lost its classification/relationship/delivery metadata while the same
    // request in headless mode kept it — a dual-mode drift (TRDD-903b7a20 #9).
    ...(body.severity !== undefined && { severity: body.severity }),
    ...(body.effort !== undefined && { effort: body.effort }),
    ...(body.parentTask !== undefined && { parentTask: body.parentTask }),
    ...(body.npt !== undefined && { npt: body.npt }),
    ...(body.eht !== undefined && { eht: body.eht }),
    ...(body.supersedes !== undefined && { supersedes: body.supersedes }),
    ...(body.relevantRules !== undefined && { relevantRules: body.relevantRules }),
    ...(body.releaseVia !== undefined && { releaseVia: body.releaseVia }),
    // TRDD-v2 evidence + new fields — now carried end-to-end through
    // CreateTaskParams → createTeamTask → ghProject.createTask (TRDD-95d23f3b).
    ...(body.reviewResult !== undefined && { reviewResult: body.reviewResult }),
    ...(body.supersededBy !== undefined && { supersededBy: body.supersededBy }),
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
  const result = await createTeamTask(id, safeParams)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
