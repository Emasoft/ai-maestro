import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listAllGroups, createNewGroup } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  subscriberIds: z.array(z.string().uuid()).max(100).optional(),
}).strict()

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
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = CreateGroupSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }

    const result = await createNewGroup(parsed.data)
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
