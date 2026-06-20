import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getKanbanConfig, setKanbanConfig } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import type { KanbanColumnConfig } from '@/types/team'

const KanbanColumnSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  color: z.string().min(1).max(64),
  icon: z.string().max(64).optional(),
  // Per-column move-permission (TRDD-v2 #2 spec): governance titles allowed to
  // move a task INTO this column. undefined/empty = any title may move tasks here.
  roles: z.array(z.string().max(64)).max(20).optional(),
}).strict()

const UpdateKanbanConfigSchema = z.object({
  // Widened to 20 columns to fit the 17-stage default set (14 lifecycle + 3
  // exception states) plus headroom for a few custom columns.
  columns: z.array(KanbanColumnSchema).min(1).max(20),
}).strict()

// GET /api/teams/[id]/kanban-config - Get team's kanban column configuration
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

  const result = await getKanbanConfig(id, auth.agentId)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// PUT /api/teams/[id]/kanban-config - Set team's kanban column configuration
export async function PUT(
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

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateKanbanConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  const result = await setKanbanConfig(id, parsed.data.columns as KanbanColumnConfig[], auth.agentId)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
