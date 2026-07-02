import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listAllGroups, createNewGroup } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'

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
    return internalError(error, 'groups-list')
  }
}

// POST /api/groups - Create a new group
// Authentication required (middleware + enforceAuth). Group creation is
// open to any authenticated caller — governance-free per R20.
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  // SVC2-MAJ-07 (2026-05-06): forward authContext to the service.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const authContext = buildAuthContext(auth)

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

    const result = await createNewGroup(parsed.data, authContext)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return internalError(error, 'groups-create')
  }
}
