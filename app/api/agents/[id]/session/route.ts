import { NextRequest, NextResponse } from 'next/server'
import { requireSudoToken } from '@/lib/sudo-guard'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import {
  getAgentSessionStatus,
  linkAgentSession,
  sendAgentSessionCommand,
  unlinkOrDeleteAgentSession,
} from '@/services/agents-core-service'
import { isValidUuid } from '@/lib/validation'
import { enforceAuth, requireAuth } from '@/lib/route-auth'

/**
 * POST /api/agents/[id]/session
 * Link a tmux session to an agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // SVC2-CRIT-02 fix (2026-05-06): build AuthContext and forward to service.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = await linkAgentSession(id, body, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Session POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]/session
 * Send a command to the agent's tmux session
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // SVC2-CRIT-02 fix (2026-05-06): forward AuthContext for authorization.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await sendAgentSessionCommand(id, {
      command: body.command,
      requireIdle: body.requireIdle,
      addNewline: body.addNewline,
    }, auth.context)

    if (result.error && result.status !== 409) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status || 500 }
      )
    }

    // For 409 (not idle), include data + error together
    if (result.status === 409) {
      return NextResponse.json(
        { success: false, error: result.error, ...result.data },
        { status: 409 }
      )
    }

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Session PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/agents/[id]/session
 * Get session status for an agent
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const result = await getAgentSessionStatus(id)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status || 500 }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Session GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/session
 * Unlink session from agent, optionally kill the tmux session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const searchParams = request.nextUrl.searchParams
    const shouldDeleteAgent = searchParams.get('deleteAgent') === 'true'

    // ── API2-CRIT-02 fix (2026-05-06) — gate `?deleteAgent=true` ──
    // The previous code dispatched directly to `unlinkOrDeleteAgentSession`,
    // which on `deleteAgent=true` invoked the lowercase `deleteAgent`
    // helper — bypassing the entire `DeleteAgent` element-management
    // pipeline (no R9.13 role-plugin guard, no team/COS guard, no
    // ~/agents/<name>/ enforcement, no cemetery archive) AND requiring
    // no sudo token. The deprecated `/api/sessions/[id]` redirected
    // here, so the canonical session-delete path bypassed every
    // SEC-PHASE gate the project added.
    //
    // Fix: when the caller asks for hard agent deletion via this route,
    // (1) require a sudo token (parallels the strict classification of
    // the sibling `DELETE /api/agents/[id]`) and (2) route the actual
    // delete through the proper `DeleteAgent` AIO so every governance
    // gate runs. The session-only branch (kill=true / no deleteAgent)
    // keeps the existing fast path.
    if (shouldDeleteAgent) {
      const sudoErr = requireSudoToken(request, 'DELETE', '/api/agents/[id]/session')
      if (sudoErr) return sudoErr

      const auth = authenticateFromRequest(request)
      if (auth.error) {
        return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
      }
      const authContext = buildAuthContext(auth)

      const { DeleteAgent } = await import('@/services/element-management-service')
      const result = await DeleteAgent(id, {
        hard: true,
        deleteFolder: true,
        authContext,
      })
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'DeleteAgent pipeline failed' },
          { status: 400 }
        )
      }
      return NextResponse.json({ ok: true, agentId: id, operations: result.operations })
    }

    // Session-only path: kill the tmux session but leave the agent record.
    // SVC2-CRIT-02 fix (2026-05-06): build AuthContext from earlier auth (already
    // resolved via authenticateFromRequest above for the deleteAgent branch).
    const sessionAuth = authenticateFromRequest(request)
    if (sessionAuth.error) {
      return NextResponse.json({ error: sessionAuth.error }, { status: sessionAuth.status || 401 })
    }
    const result = await unlinkOrDeleteAgentSession(id, {
      kill: searchParams.get('kill') === 'true',
      deleteAgent: false,
    }, buildAuthContext(sessionAuth))

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Session DELETE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
