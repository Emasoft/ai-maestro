import { NextRequest, NextResponse } from 'next/server'
import { listAllGroups, createNewGroup } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

// Force dynamic -- reads runtime filesystem state (group registry)
export const dynamic = 'force-dynamic'

// GET /api/groups - List all groups
export async function GET() {
  try {
    const result = listAllGroups()
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('Failed to list groups:', error)
    return NextResponse.json(
      { error: `Failed to list groups: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}

// POST /api/groups - Create a new group
// Authentication required (middleware + enforceAuth). Group creation is
// open to any authenticated caller — governance-free per R20.
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { name, description, subscriberIds } = body

    // Validate required field: name
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required and must be a string' }, { status: 400 })
    }
    // Validate optional fields
    if (description !== undefined && typeof description !== 'string') {
      return NextResponse.json({ error: 'description must be a string' }, { status: 400 })
    }
    if (subscriberIds !== undefined && (!Array.isArray(subscriberIds) || !subscriberIds.every((id: unknown) => typeof id === 'string'))) {
      return NextResponse.json({ error: 'subscriberIds must be an array of strings' }, { status: 400 })
    }

    const result = await createNewGroup({ name, description, subscriberIds })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('Failed to create group:', error)
    return NextResponse.json(
      { error: `Failed to create group: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
