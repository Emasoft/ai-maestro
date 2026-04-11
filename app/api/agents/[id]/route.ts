import { NextRequest, NextResponse } from 'next/server'
import { getAgentById, updateAgentById } from '@/services/agents-core-service'
import type { UpdateAgentRequest } from '@/types/agent'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

/**
 * GET /api/agents/[id]
 * Get a specific agent by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CC-GOV-008: Auth required to prevent metadata leaks via Tailscale
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const result = getAgentById(id)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Agents GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]
 * Update an agent
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Identity auth only — authorization is handled by each Change* function
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    let body: UpdateAgentRequest
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // #116: PATCH is a dispatcher — updateAgentById routes many fields through
    // element-management-service Change* pipelines. Some of those pipelines
    // are strictly destructive and require a sudo token. We inspect the body
    // and gate individually:
    //
    //   governanceTitle  → ChangeTitle   (irreversible governance transition)
    //   program          → ChangeClient  (uninstalls all plugins + re-emits;
    //                                     cannot round-trip losslessly — see
    //                                     R18.3b "never X→Claude lossy")
    //
    // All other fields (name, label, avatar, model, tags, workingDirectory,
    // preferences, metadata, documentation, ...) stay at "normal" auth.
    //
    // WHY `in` and not `=== 'string'`: null is a legal value meaning "clear
    // the title", and the client sends it as literal null. Using `in` is
    // also the only way to detect `undefined`-typed dispatch fields without
    // erroneously accepting a `{ governanceTitle: undefined }` body that
    // would otherwise slip through.
    //
    // WHY governanceTitle (not title): the UpdateAgentRequest type uses the
    // field name `governanceTitle` (see types/agent.ts:549). `title` is not
    // a member of the type — an earlier draft that checked `body.title` was
    // a latent bypass.
    if (body) {
      if ('governanceTitle' in body) {
        const sudoErr = requireSudoToken(request, 'PATCH', '/api/agents/[id]/title')
        if (sudoErr) return sudoErr
      }
      if ('program' in body) {
        // Client change reuses the same strict classification — one sudo
        // token covers either destructive dispatch. Registry lookup is by
        // METHOD + pathTemplate, so we reuse the title entry.
        const sudoErr = requireSudoToken(request, 'PATCH', '/api/agents/[id]/title')
        if (sudoErr) return sudoErr
      }
    }

    // Pass full auth context — each Change* function decides its own authorization
    const result = await updateAgentById(id, body, auth.agentId || null, buildAuthContext(auth))
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Agents PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]
 * Delete an agent. Soft-delete by default (preserves data, marks as deleted).
 * Pass ?hard=true for permanent deletion (creates backup first).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Sudo mode required — agent deletion is classified "strict" in
    // security-registry.json. The caller must have re-entered the
    // governance password within the last 60s and present X-Sudo-Token.
    const sudoErr = requireSudoToken(request, 'DELETE', '/api/agents/[id]')
    if (sudoErr) return sudoErr

    // Identity auth only — DeleteAgent has its own Gate 0 for authorization
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const hardParam = request.nextUrl.searchParams.get('hard')?.toLowerCase()
    const hard = hardParam === 'true' || hardParam === '1' || hardParam === 'yes'
    const deleteFolderParam = request.nextUrl.searchParams.get('deleteFolder')?.toLowerCase()
    const deleteFolder = deleteFolderParam === 'true' || deleteFolderParam === '1' || deleteFolderParam === 'yes'

    // Delegate to the all-in-one pipeline
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent(id, {
      authContext: buildAuthContext(auth),
      hard,
      deleteFolder,
    })

    if (!result.success) {
      const errStr = String(result.error ?? '')
      const status = errStr.includes('not found') ? 404
        : errStr.includes('already deleted') ? 410
        : 403
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ success: true, hard: result.hard })
  } catch (error) {
    console.error('[Agents DELETE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
