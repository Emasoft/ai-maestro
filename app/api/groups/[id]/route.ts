import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getGroupById, updateGroupById, deleteGroupById } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  subscriberIds: z.array(z.string().uuid()).max(100).optional(),
}).strict()

// GET /api/groups/[id] - Get a single group
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = getGroupById(id)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to get group:', error)
    return NextResponse.json(
      { error: `Failed to get group: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// PUT /api/groups/[id] - Update a group
// Accepts { name?, description?, subscriberIds? }
// Authentication required (middleware + enforceAuth). Group updates are
// open to any authenticated caller — governance-free per R20.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id } = await params

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = UpdateGroupSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }

    const result = await updateGroupById(id, parsed.data)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to update group:', error)
    return NextResponse.json(
      { error: `Failed to update group: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// DELETE /api/groups/[id] - Delete a group
// Authentication required — governance-free per R20.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id } = await params
    const result = await deleteGroupById(id)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to delete group:', error)
    return NextResponse.json(
      { error: `Failed to delete group: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
