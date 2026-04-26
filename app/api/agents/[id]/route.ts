import { NextRequest, NextResponse } from 'next/server'
import { getAgentById, updateAgentById, bodyHasChangeableField } from '@/services/agents-core-service'
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

    // PROP #1 (2026-04-22 security tightening): PATCH is a dispatcher —
    // updateAgentById routes every CHANGEABLE_FIELD through an
    // element-management-service Change* pipeline. Change* pipelines run
    // privileged multi-step operations: registry writes, plugin installs,
    // plugin uninstalls + re-emits (ChangeClient R18), tmux rename
    // (ChangeName), CLI-arg substitution (ChangeCLIArgs — accepts
    // `--dangerously-skip-permissions`), folder moves (ChangeFolder —
    // can escape ~/agents/ if validation is bypassed), avatar path
    // writes, and governance-title transitions. Every one of these is a
    // security-relevant operation that a user should consciously
    // re-authenticate for — the attack surface is not just the title
    // or client change the previous (narrow) gate covered.
    //
    // OLD gate (pre-PROP #1): only governanceTitle and program triggered
    // sudo. That meant:
    //   - A renamed agent could silently hijack AMP identity (name is the
    //     address agents are reached at — see R14 AMP adjacency checks).
    //   - programArgs could inject --dangerously-skip-permissions into
    //     the next launch without sudo (SEC-P1-04).
    //   - workingDirectory could be retargeted outside ~/agents/ if a
    //     future Change* regression weakens ChangeFolder Gate 3.
    //   - avatar path writes (cosmetic, low risk) slipped through
    //     unchallenged.
    //
    // NEW gate: ANY CHANGEABLE_FIELD or legacy alias triggers a single
    // sudo check. Non-Change* fields (label, model, tags, preferences,
    // metadata, documentation) keep their existing "normal-auth" gate —
    // those are plain registry writes.
    //
    // Implementation via the shared `bodyHasChangeableField()` helper
    // means there is ONE place to edit the list, and TypeScript enforces
    // that CHANGEABLE_FIELDS stays in sync with UpdateAgentRequest
    // (via `satisfies readonly (keyof UpdateAgentRequest)[]` in
    // services/agents-core-service.ts — PROP #3).
    //
    // Path template: `/api/agents/[id]/title` is reused as the strict-
    // route registry key. security-registry.json already classifies this
    // key as strict. The route handler itself is /api/agents/[id]
    // (rewrite-neutral), so the key is a logical tag for the "agent
    // destructive-op" family, not a literal path.
    if (bodyHasChangeableField(body)) {
      const sudoErr = requireSudoToken(request, 'PATCH', '/api/agents/[id]/title')
      if (sudoErr) return sudoErr
    }

    // Pass full auth context — each Change* function decides its own authorization
    const result = await updateAgentById(id, body, auth.agentId || null, buildAuthContext(auth))
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    // BUG-003 fix: flatten side-channel data (restartNeeded, warnings) from
    // Change* pipelines into the JSON response body so the client-side
    // useRestartQueue hook can react to a successful client change and the
    // UI can surface non-fatal warnings. Existing `agent` shape is preserved
    // — this only ADDS optional top-level fields.
    //
    // Shape contract:
    //   { agent: Agent, restartNeeded?: boolean, warnings?: string[] }
    //
    // `restartNeeded` / `warnings` are only present when a Change* pipeline
    // actually emitted them (currently only ChangeClient). For simple-field
    // PATCHes (name, model, tags, ...) the response body is just `{ agent }`.
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
