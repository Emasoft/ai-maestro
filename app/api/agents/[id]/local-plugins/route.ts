/**
 * Local Plugin Operations API
 *
 * POST /api/agents/[id]/local-plugins — Mutate a locally-installed plugin.
 *
 * Two body shapes accepted:
 *   1. Toggle  : { key, enabled: boolean }
 *      Maps to ChangePlugin action='enable' | 'disable' (legacy form).
 *   2. Update  : { key, action: 'update' }
 *      Maps to ChangePlugin action='update'. For non-local marketplaces
 *      ChangePlugin first refreshes the marketplace cache (uninstall +
 *      reinstall pulls the latest version via `claude plugin install`).
 *
 * The discriminator is the presence of `action` in the body. If `action`
 * is set, it wins over `enabled` (so a misformed body that includes both
 * does the safer-named operation). If neither is set, returns 400.
 *
 * All paths return `restartNeeded` so the UI can queue a stop+restart of
 * the agent's session — every plugin state mutation requires it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { ChangePlugin } from '@/services/element-management-service'
import { isValidUuid } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // #114: Authenticate before any side effect.
  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const body = await req.json()
    const { key, enabled, action } = body as { key?: string; enabled?: boolean; action?: string }

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'key is required (plugin key in name@marketplace format)' }, { status: 400 })
    }

    // Parse plugin key into name and marketplace
    const atIdx = key.lastIndexOf('@')
    if (atIdx <= 0) {
      return NextResponse.json({ error: 'Invalid plugin key format — expected name@marketplace' }, { status: 400 })
    }
    const pluginName = key.substring(0, atIdx)
    const marketplace = key.substring(atIdx + 1)

    // Resolve the ChangePlugin action from the body. `action` takes
    // precedence — when it's set, the request is an update. Otherwise
    // fall back to the legacy enable/disable toggle form.
    let resolvedAction: 'enable' | 'disable' | 'update'
    if (action === 'update') {
      resolvedAction = 'update'
    } else if (typeof enabled === 'boolean') {
      resolvedAction = enabled ? 'enable' : 'disable'
    } else {
      return NextResponse.json({
        error: 'Body must include either { enabled: boolean } (toggle) or { action: "update" }',
      }, { status: 400 })
    }

    // ChangePlugin's G02 guard rejects role-plugin operations unless the
    // caller opts in with rolePluginSwap=true. For UPDATE we set it
    // unconditionally — the flag's name carries N:1-swap semantics
    // historically, but the gate only checks `isRolePlugin && !flag`, so
    // setting it lets predefined role-plugin updates through. For non-role
    // plugins the flag is a no-op (G02 doesn't fire). G11b (programArgs
    // rewrite) is bound to action='install', so an update passes through
    // it without rewriting --agent (correct: an update keeps the same
    // plugin, the --agent flag stays valid).
    const result = await ChangePlugin(agentId, {
      name: pluginName,
      marketplace,
      action: resolvedAction,
      scope: 'local',
      rolePluginSwap: resolvedAction === 'update',
    }, auth.context)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Forward restartNeeded so the UI can re-queue the agent's session
    // for restart. ChangePlugin always sets it true for state mutations,
    // but we propagate the actual value rather than hard-coding it —
    // future pipeline gates (e.g. no-op idempotent paths) may flip it
    // false and we want the UI to honour that.
    return NextResponse.json({
      success: true,
      key,
      action: resolvedAction,
      ...(typeof enabled === 'boolean' && { enabled }),
      restartNeeded: result.restartNeeded,
    })
  } catch (error) {
    console.error('[local-plugins] POST failed:', error)
    return NextResponse.json({ error: 'Failed to mutate plugin' }, { status: 500 })
  }
}
