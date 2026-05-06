import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyGroupSubscribers } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

const NotifyGroupSchema = z.object({
  message: z.string().min(1).max(4096),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
}).strict()

// POST /api/groups/[id]/notify - Notify all group subscribers
// Body: { message: string, priority?: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { id } = await params

  // Validate group ID format (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid group ID' }, { status: 400 })
  }

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = NotifyGroupSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  // SVC2-MAJ-08 (2026-05-06): forward authContext for the per-sender rate limit.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const result = await notifyGroupSubscribers(id, parsed.data.message, parsed.data.priority, buildAuthContext(auth))
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error(`[Groups Notify] Failed to notify group ${id}:`, err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
