/**
 * POST /api/agents/[id]/element-inventory
 *
 * Append a snapshot of the agent's currently-loaded elements (memory
 * files, skills, agents, MCP tools, etc.) to the per-agent ledger
 * stored at `~/.aimaestro/element-inventory/<agentId>.jsonl`.
 *
 * This endpoint is INTENDED to be called by the ai-maestro-plugin
 * SessionStart hook and the reload-plugins string-detection hook
 * (Phase C2). As of TRDD-YEE33F3A that half has not shipped: nothing
 * in this repo, in `scripts/`, in the headless router, or in the
 * installed `ai-maestro-plugin` posts here. The READER half is live —
 * the JSONL Session Browser calls `getLatestInventoryAtOrBefore` to
 * show historical token sizes matching what Claude actually saw, even
 * after the user has since edited memory or toggled plugins. So this
 * is an unfinished feature, not dead code; it is authorized, not
 * deleted.
 *
 * Trigger taxonomy:
 *   - `session_start`   : Claude Code SessionStart hook fired
 *   - `reload_plugins`  : `/reload-plugins` slash command detected
 *   - `manual`          : user invoked the API directly (debugging)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import {
  appendInventorySnapshot,
  ForeignLedgerError,
  type InventoryTrigger,
  type LedgerElement,
} from '@/services/element-inventory-ledger'

const VALID_TRIGGERS: InventoryTrigger[] = ['session_start', 'reload_plugins', 'manual']
const VALID_BUCKETS: LedgerElement['bucket'][] = [
  'memory',
  'skills',
  'customAgents',
  'mcpTools',
  'systemTools',
  'hooks',
  'commands',
  'output_styles',
  'lsp',
  'rules',
]
const VALID_SCOPES: LedgerElement['scope'][] = ['user', 'project', 'plugin', 'builtin']

/**
 * Validate agent id — alphanumeric + dash + underscore + dot + at-sign
 * (so `agentId@hostId` works for multi-host agents). Defense in depth
 * even though the ledger service also sanitizes when building the
 * file path.
 */
function isValidAgentId(id: string): boolean {
  if (typeof id !== 'string') return false
  if (id.length === 0 || id.length > 128) return false
  return /^[a-zA-Z0-9_.@-]+$/.test(id)
}

function isValidElement(v: unknown): v is LedgerElement {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > 256) return false
  if (typeof o.tokens !== 'number' || !Number.isFinite(o.tokens) || o.tokens < 0) return false
  if (!VALID_SCOPES.includes(o.scope as LedgerElement['scope'])) return false
  if (!VALID_BUCKETS.includes(o.bucket as LedgerElement['bucket'])) return false
  if (o.detail !== undefined && (typeof o.detail !== 'string' || o.detail.length > 1024)) return false
  return true
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // TRDD-YEE33F3A. This called `enforceAuth`, which authenticates and DISCARDS
  // the identity, so any authenticated agent could append forged snapshots to
  // ANY agent's ledger — an audit surface the Session Browser presents as "what
  // Claude actually saw".
  //
  // The action is OWNERSHIP, not `modify-agent`. Two reasons, and the second is
  // decisive: appending to an audit ledger is not reconfiguring an agent; and
  // `modify-agent` is absent from SELF_DRIVE_ACTIONS, so the universal
  // self-target ban would 403 the only caller this endpoint has ever been
  // written for — an agent's own SessionStart hook, posting about itself.
  // Authorizing it with `modify-agent` would have shipped a permanently
  // uncallable endpoint.
  //
  // Exact match on the bare agent id: the reader keys the ledger on the UUID
  // from `deriveAgentIdFromCwd`, so an agent writes exactly `<uuid>.jsonl`.
  // Accepting a qualified `uuid@host` from an agent caller would let it create a
  // second, orphaned ledger the reader never reads. The system owner (the
  // `manual` debugging trigger) keeps the full id space.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    if (!isValidAgentId(agentId)) {
      return NextResponse.json({ error: 'Invalid agent id format' }, { status: 400 })
    }
    if (auth.agentId && auth.agentId !== agentId) {
      return NextResponse.json(
        { error: 'Forbidden — you may only write your own element inventory' },
        { status: 403 },
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
    }
    const b = body as Record<string, unknown>

    if (!VALID_TRIGGERS.includes(b.trigger as InventoryTrigger)) {
      return NextResponse.json(
        { error: `Invalid trigger; expected one of ${VALID_TRIGGERS.join(', ')}` },
        { status: 400 },
      )
    }

    if (!Array.isArray(b.elements)) {
      return NextResponse.json({ error: 'elements must be an array' }, { status: 400 })
    }
    // Cap at 5_000 elements per snapshot to prevent runaway writes
    // (a fully-instrumented agent should be well under 1_000).
    if (b.elements.length > 5_000) {
      return NextResponse.json(
        { error: 'elements array exceeds 5000-item cap' },
        { status: 400 },
      )
    }
    const elements: LedgerElement[] = []
    for (const e of b.elements) {
      if (!isValidElement(e)) {
        return NextResponse.json(
          { error: 'Invalid element entry — see API docs for required shape' },
          { status: 400 },
        )
      }
      elements.push(e)
    }

    const tsRaw = b.ts
    const ts = typeof tsRaw === 'string' && !Number.isNaN(new Date(tsRaw).getTime())
      ? tsRaw
      : new Date().toISOString()

    await appendInventorySnapshot({
      ts,
      trigger: b.trigger as InventoryTrigger,
      agentId,
      elements,
    }, auth.context)

    return NextResponse.json({ ok: true, ts, count: elements.length })
  } catch (error) {
    // The service's ownership guard throws rather than returning an envelope.
    // Without this branch a denial would be reported as 500 — indistinguishable
    // from a full disk, and the defence-in-depth layer would be invisible.
    if (error instanceof ForeignLedgerError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[element-inventory POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
