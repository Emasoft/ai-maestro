import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { readTrdd, editTrdd } from '@/lib/trdd-store'
import { withAuthorizedTrdd } from '@/lib/trdd-authz'

/**
 * GET /api/trdd/[id] — read one TRDD (full frontmatter + body) by its 8-char id.
 * Query `agentId` selects the project; default = the server's own design/.
 * Read-only ⇒ non-strict.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const designDir = resolveDesignDir(request.nextUrl.searchParams.get('agentId'))
  const trdd = readTrdd(designDir, id)
  if (!trdd) {
    return NextResponse.json({ error: 'TRDD not found' }, { status: 404 })
  }
  return NextResponse.json({ trdd })
}

/**
 * PATCH /api/trdd/[id] — edit frontmatter fields in place (no folder move);
 * `updated` is always bumped. Body: `{fields: {<name>: <string>, ...}, agentId?}`.
 *
 * STRICT: mutates git-tracked project state. For a folder-crossing transition
 * (proposal→planned, →archived, …) use the dedicated approve/refuse/archive
 * routes instead — this route deliberately does NOT move files between zones.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'PATCH', '/api/trdd/[id]')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const fields = body?.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return NextResponse.json({ error: 'Body must include a {fields} object of frontmatter edits' }, { status: 400 })
  }
  // Every value must be a plain string — the line-based writer emits `field: value`
  // verbatim, so a non-string (object/array) would corrupt the grep-first format.
  const edits: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string') {
      return NextResponse.json({ error: `Field "${k}" must be a string (flow-style value, e.g. "[a, b]")` }, { status: 400 })
    }
    edits[k] = v
  }

  const designDir = resolveDesignDir(typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF: `edit` is the mechanical column transition, EXEMPT from
  // approval — so the gate is OWNERSHIP, not tier: the card's assignee, its
  // team's ORCHESTRATOR, or MANAGER. The sudo-guard deferred this route.
  //
  // TRDD-6D6SQNI6: the decision and the write are ONE critical section on the card,
  // because ownership is read off the very frontmatter a racing peer would be editing.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'edit', () =>
    editTrdd(designDir, id, edits, new Date().toISOString()),
  )
  if (outcome.denied) return outcome.denied

  const result = outcome.value
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
