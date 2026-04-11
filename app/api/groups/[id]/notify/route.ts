import { NextRequest, NextResponse } from 'next/server'
import { notifyGroupSubscribers } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate body is a plain object (not null, array, or primitive)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const { message, priority } = body as Record<string, unknown>

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'message is required and must be a string' }, { status: 400 })
  }

  if (priority !== undefined && typeof priority !== 'string') {
    return NextResponse.json({ error: 'priority must be a string' }, { status: 400 })
  }

  // Validate priority enum if provided
  if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority as string)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  try {
    const result = await notifyGroupSubscribers(id, message, priority)
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
