import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTeamDocument, updateTeamDocument, deleteTeamDocument } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

const UpdateDocSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  content: z.string().max(65536).optional(),
  pinned: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
}).strict()

// GET /api/teams/[id]/documents/[docId] - Get a single document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params
  // MF-005: Validate UUID format for both path parameters to prevent path traversal
  if (!isValidUuid(id) || !isValidUuid(docId)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId
  const result = getTeamDocument(id, docId, requestingAgentId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// PUT /api/teams/[id]/documents/[docId] - Update a document
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params
  // MF-005: Validate UUID format for both path parameters to prevent path traversal
  if (!isValidUuid(id) || !isValidUuid(docId)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
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

  const parsed = UpdateDocSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const body = parsed.data

  const { title, content, pinned, tags } = body
  const result = await updateTeamDocument(id, docId, { title, content, pinned, tags, requestingAgentId })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// DELETE /api/teams/[id]/documents/[docId] - Delete a document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params
  // MF-005: Validate UUID format for both path parameters to prevent path traversal
  if (!isValidUuid(id) || !isValidUuid(docId)) {
    return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  const result = await deleteTeamDocument(id, docId, requestingAgentId)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
