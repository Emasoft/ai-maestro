/**
 * Publish Plugin — Copies a validated plugin from Haephestos workspace to local marketplace
 *
 * POST /api/agents/creation-helper/publish-plugin
 *
 * Accepts a plugin directory path inside ~/agents/haephestos/build/.
 * Validates quad-identity + compatible-titles/clients, then copies to
 * ~/agents/role-plugins/<name>/ and registers in marketplace manifest.
 *
 * Haephestos is responsible for ALL content edits (compatible-titles, compatible-clients,
 * version, description, etc.) BEFORE calling this endpoint. The API only validates and copies.
 *
 * TRDD-1LFRP6GJ: this route is now SYSTEM-OWNER only, joining the six routes
 * `85865270` already gated. Its logic used to be the persona's second (and last)
 * documented API call — the persona's own curl carried no credential and 401ed
 * under `middleware.ts` before this route was even reached, so tightening this
 * route cannot break a path that was already broken. The persona no longer
 * calls this route at all: its fallback now writes a request file that
 * `services/creation-helper-service.ts`'s publish-request poller picks up and
 * hands, in-process, to `services/haephestos-publish-service.ts::publishHaephestosPlugin`
 * — the same function this route calls below, so the validation/copy logic
 * (and its existing test coverage) is unchanged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publishHaephestosPlugin } from '@/services/haephestos-publish-service'
import { enforceSystemOwner } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Publishing a Haephestos-built plugin copies it into the local
  // role-plugins marketplace and registers it with the Claude CLI —
  // destructive mutation of the local marketplace. This is a wizard-only
  // dashboard flow (the persona reaches the same logic via the file-based
  // request/response protocol below, never over HTTP) — system owner only.
  const authErr = enforceSystemOwner(req)
  if (authErr) return authErr

  try {
    let body: { pluginDir?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.pluginDir || typeof body.pluginDir !== 'string') {
      return NextResponse.json({ error: 'pluginDir is required' }, { status: 400 })
    }

    const outcome = await publishHaephestosPlugin(body.pluginDir)
    return NextResponse.json(outcome.body, { status: outcome.status })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[publish-plugin] Failed:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'creation-helper-publish-plugin' },
      { status: 500 },
    )
  }
}
