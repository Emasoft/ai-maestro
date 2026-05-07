/**
 * POST /api/agents/[id]/element-inventory
 *
 * Append a snapshot of the agent's currently-loaded elements (memory
 * files, skills, agents, MCP tools, etc.) to the per-agent ledger
 * stored at `~/.aimaestro/element-inventory/<agentId>.jsonl`.
 *
 * This endpoint is called by the ai-maestro-plugin SessionStart hook
 * and the reload-plugins string-detection hook (Phase C2 — separate
 * commit). The JSONL Session Browser then uses the latest snapshot
 * at-or-before the selected transcript message's timestamp to show
 * historical token sizes that match what Claude actually saw at the
 * time, even after the user has since edited memory or toggled
 * plugins.
 *
 * Trigger taxonomy:
 *   - `session_start`   : Claude Code SessionStart hook fired
 *   - `reload_plugins`  : `/reload-plugins` slash command detected
 *   - `manual`          : user invoked the API directly (debugging)
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import {
  appendInventorySnapshot,
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
  // R0: authenticate first — the SessionStart hook posts via AID
  // proof-of-possession (Ed25519) like every other agent-scoped
  // endpoint. No bypass.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id: agentId } = await params
    if (!isValidAgentId(agentId)) {
      return NextResponse.json({ error: 'Invalid agent id format' }, { status: 400 })
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
    })

    return NextResponse.json({ ok: true, ts, count: elements.length })
  } catch (error) {
    console.error('[element-inventory POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
