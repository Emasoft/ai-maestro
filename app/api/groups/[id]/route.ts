import { NextRequest, NextResponse } from 'next/server'
import { getGroupById, updateGroupById, deleteGroupById } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

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

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { name, description, subscriberIds } = body

    // Validate optional fields have correct types
    if (name !== undefined && typeof name !== 'string') {
      return NextResponse.json({ error: 'name must be a string' }, { status: 400 })
    }
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
    }
    if (subscriberIds !== undefined && (!Array.isArray(subscriberIds) || !subscriberIds.every((id: unknown) => typeof id === 'string'))) {
      return NextResponse.json({ error: 'subscriberIds must be an array of strings' }, { status: 400 })
    }

    const result = await updateGroupById(id, { name, description, subscriberIds })
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
