import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listTeamDocuments, createTeamDocument } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const CreateDocSchema = z.object({
  title: z.string().min(1).max(256),
  content: z.string().max(65536).optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
}).strict()

// GET /api/teams/[id]/documents - List all documents for a team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // MF-005: Validate UUID format for team ID to prevent path traversal
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId
  const result = listTeamDocuments(id, requestingAgentId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// POST /api/teams/[id]/documents - Create a new document
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // MF-005: Validate UUID format for team ID to prevent path traversal
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

  const parsed = CreateDocSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { title, content, pinned, tags } = body
  const result = await createTeamDocument(id, { title, content, pinned, tags, requestingAgentId })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
