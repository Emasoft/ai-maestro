/**
 * Universal gated settings editor API (TRDD-RYFP030K).
 *
 * The HTTP transport over `lib/settings-gate.ts`'s `editSettings` / `readSettings` — the
 * SAME shared function `scripts/aimaestro-settings-cli.mjs` calls in-process, without
 * HTTP, so the installer (which runs with this server DOWN) can still edit settings
 * safely. This route exists for callers that DO have the server up and want the
 * identical validated-path + locked + fsync'd + backed-up write, over the network.
 *
 * GET  /api/settings/edit?path=<abs path>                  -> { ok, data } | { ok:false, reason, error }
 * POST /api/settings/edit  { path, ops, createIfMissing? }  -> { success:true, ...UpdateJsonResult }
 *
 * LOCALHOST-ONLY (deliberate, and NARROWER than most admin routes in this repo):
 * `settings.json` / `settings.local.json` decide which plugins run for the human user
 * and for every agent on this host. Exposing arbitrary `set`/`delete` on them to any
 * device on the Tailscale VPN would be a real capability, not a convenience — a stolen
 * session cookie on a remote device could otherwise toggle plugins fleet-wide.
 * `isConsolePeer` (never `x-forwarded-for`, which is client-forgeable — see
 * `lib/peer-address.mjs`) restricts this route to the PHYSICAL machine, on top of
 * `enforceSystemOwner` restricting it to the human user (never an agent's AID token) —
 * the same pairing `app/api/settings/marketplaces/route.ts` uses for the owner half,
 * with the console check layered on because this route's blast radius is larger (it can
 * rewrite ANY agent's `settings.local.json`, not just the user-scope marketplace state).
 */
import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { isConsolePeer, peerAddress } from '@/lib/peer-address.mjs'
import {
  editSettings,
  readSettings,
  InvalidSettingsPathError,
  type SettingsOp,
} from '@/lib/settings-gate'
import { UnreadableTargetError, ConcurrentModificationError, KeyLossRefused } from '@/lib/json-io'

export const dynamic = 'force-dynamic'

function refuseConsole(): NextResponse {
  return NextResponse.json(
    {
      error: 'console_required',
      message:
        'Settings can only be edited from the machine running AI Maestro. ' +
        'Use aimaestro-settings.sh (which never needs this route), or the dashboard from this host.',
    },
    { status: 403 },
  )
}

function isValidOp(op: unknown): op is SettingsOp {
  if (!op || typeof op !== 'object') return false
  const o = op as Record<string, unknown>
  if (o.op !== 'set' && o.op !== 'delete') return false
  if (!Array.isArray(o.keyPath) || o.keyPath.length === 0 || !o.keyPath.every(k => typeof k === 'string')) return false
  return true
}

export async function GET(request: NextRequest) {
  if (!isConsolePeer(peerAddress(request))) return refuseConsole()
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const path = request.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path query param is required' }, { status: 400 })

  try {
    const result = await readSettings(path)
    if (!result.ok) {
      // 'missing' is a legal, expected state (a first-run file); 'unreadable' means the
      // bytes on disk do not parse — the caller can tell them apart from `reason`.
      return NextResponse.json(
        { ok: false, reason: result.reason, error: result.error },
        { status: result.reason === 'missing' ? 404 : 409 },
      )
    }
    return NextResponse.json({ ok: true, data: result.data })
  } catch (err) {
    if (err instanceof InvalidSettingsPathError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[settings/edit] GET failed:', err)
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!isConsolePeer(peerAddress(request))) return refuseConsole()
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  let body: { path?: unknown; ops?: unknown; createIfMissing?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { path, ops, createIfMissing } = body
  if (typeof path !== 'string' || !path) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }
  if (!Array.isArray(ops) || ops.length === 0 || !ops.every(isValidOp)) {
    return NextResponse.json(
      { error: 'ops must be a non-empty array of { op: "set"|"delete", keyPath: string[], value? } entries' },
      { status: 400 },
    )
  }

  try {
    const result = await editSettings(path, ops, {
      createIfMissing: typeof createIfMissing === 'boolean' ? createIfMissing : undefined,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof InvalidSettingsPathError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    // Same reasoning as app/api/settings/marketplaces/route.ts: `updateJson` raises
    // UnreadableTargetError when the target exists and does not parse — 409, not 500,
    // because the state on disk is UNKNOWN, not broken.
    if (err instanceof UnreadableTargetError) {
      return NextResponse.json({ error: err.message, errorType: 'unreadable-settings' }, { status: 409 })
    }
    if (err instanceof ConcurrentModificationError) {
      return NextResponse.json({ error: err.message, errorType: 'concurrent-modification' }, { status: 409 })
    }
    if (err instanceof KeyLossRefused) {
      return NextResponse.json({ error: err.message, errorType: 'key-loss-refused' }, { status: 409 })
    }
    console.error('[settings/edit] POST failed:', err)
    return NextResponse.json({ error: 'edit failed' }, { status: 500 })
  }
}
