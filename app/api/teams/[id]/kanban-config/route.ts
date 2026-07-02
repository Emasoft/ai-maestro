import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getKanbanConfig, setKanbanConfig } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
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

  // GOV-AUDIT fix (2026-06-21): forward AuthContext so getKanbanConfig's
  // checkTeamAccess can recognize a verified system-owner web-UI session. Without
  // it, checkTeamAccess sees requestingAgentId=undefined AND no authContext and
  // fails closed on the anonymous branch — so the web UI was wrongly 403'd in
  // FULL (Next.js) mode while the headless mirror (which DOES forward it) worked.
  // This removes that FULL-vs-headless drift; agent callers are unaffected
  // (checkTeamAccess keys on agentId either way).
  const result = await getKanbanConfig(id, auth.agentId, buildAuthContext(auth))
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

  // GOV-AUDIT fix (2026-06-21): forward AuthContext (see GET above). Required so a
  // verified system-owner web-UI session is recognized by checkTeamAccess in FULL
  // mode, matching the headless mirror; without it the web UI got a spurious 403.
  const result = await setKanbanConfig(id, parsed.data.columns as KanbanColumnConfig[], auth.agentId, buildAuthContext(auth))
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
