/**
 * Agent plugin whitelist API (R17.24, TRDD-C455WHV3)
 *
 * GET   /api/settings/agent-plugin-whitelist — the effective whitelist, whether it is the
 *       defaults, and the defaults themselves (so the UI can offer "reset").
 * PATCH /api/settings/agent-plugin-whitelist — replace the whitelist. Body: { list: string[] }.
 *       STRICT (sudo-gated): this changes which user-scope plugins EVERY agent may load on its
 *       next wake, the same blast radius as a governance-title change.
 *
 * The store is ai-maestro's own ~/.aimaestro/system-settings.json. This route never reads or
 * writes ~/.claude/settings.json (the IRON no-user-scope-writes rule); which plugins EXIST at
 * user scope is /api/settings/global-plugins' job, and the dashboard joins the two.
 */
import { NextRequest, NextResponse } from 'next/server'

import { DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS } from '@/lib/ecosystem-constants'
import { readAgentPluginWhitelist, writeAgentPluginWhitelist, PLUGIN_KEY_RE } from '@/lib/agent-plugin-whitelist-store'
import { enforceSystemOwner } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied
  try {
    const { list, isDefault } = await readAgentPluginWhitelist()
    return NextResponse.json({ list, isDefault, defaults: [...DEFAULT_USER_SCOPE_PLUGINS_ALLOWED_FOR_AGENTS] })
  } catch (err) {
    // A corrupt store is surfaced, never masked as the defaults — the UI must show the
    // operator that their configured list is unreadable, not a list they did not set.
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied
  const sudoErr = requireSudoToken(request, 'PATCH', '/api/settings/agent-plugin-whitelist')
  if (sudoErr) return sudoErr

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const list = (raw as { list?: unknown })?.list
  if (!Array.isArray(list) || !list.every(k => typeof k === 'string' && PLUGIN_KEY_RE.test(k))) {
    return NextResponse.json({ error: 'body.list must be an array of name@marketplace plugin keys' }, { status: 400 })
  }
  try {
    const written = await writeAgentPluginWhitelist(list as string[])
    return NextResponse.json({ list: written, isDefault: false })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
