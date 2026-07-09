/**
 * Agent Export API
 *
 * GET  /api/agents/[id]/export — Export agent as ZIP download
 * POST /api/agents/[id]/export — Create transcript export job
 *
 * Thin wrapper — business logic in services/agents-transfer-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { exportAgentZip, createTranscriptExportJob } from '@/services/agents-transfer-service'
import { isValidUuid } from '@/lib/validation'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // TRDD-YEE33F3A. API2-MAJ-15 added `enforceAuth` here, and the comment it left
  // behind names exactly what the zip holds: "the agent's database, conversation
  // logs, AMP keys, and AID identity". But `enforceAuth` AUTHENTICATES and throws
  // the identity away — it returns `NextResponse | null`, never the caller. So
  // this route knew what it was handing out and still could not ask who was
  // asking. Any holder of any valid agent token could GET another agent's
  // keys/private.pem and forge signed AMP messages as it, forever.
  //
  // Both authorization guardrails were structurally blind to this: each scans for
  // `export function (POST|PUT|PATCH|DELETE)`, and exfiltration is a GET.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Authorize AFTER the id is parsed and validated, so the decision is made
    // against the real target, and BEFORE exportAgentZip touches the keys dir.
    const authz = authorize(auth, 'export-agent', id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }

    const result = await exportAgentZip(id)

    if (result.error || !result.data) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const { buffer, filename, agentId, agentName } = result.data

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n\\]/g, '_')}"`,
        'Content-Length': buffer.length.toString(),
        'X-Agent-Id': agentId,
        // SF-006 fix: Sanitize agent name to prevent header injection
        'X-Agent-Name': agentName.replace(/[\r\n]/g, ''),
        'X-Export-Version': '1.0.0'
      }
    })
  } catch (error) {
    console.error('Failed to export agent:', error)
    return NextResponse.json(
      { error: 'Failed to export agent' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // #114: Authenticate before any side effect. TRDD-YEE33F3A: authenticating was
  // never enough — authorize too.
  //
  // This verb exports conversation transcripts, not the key material its GET
  // sibling ships, so it is strictly less sharp. It carries the SAME
  // `export-agent` action anyway, for two reasons: a full conversation history is
  // still the highest-value plaintext in the system, and this verb has ZERO
  // callers today (both dashboard export dialogs use GET), so choosing the strict
  // side constrains nothing. If an agent-self transcript export is ever wanted,
  // introduce `view-transcript` deliberately, with its own matrix test — do not
  // quietly loosen this one.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    const authz = authorize(auth, 'export-agent', id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = createTranscriptExportJob(id, body)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to create transcript export job:', error)
    return NextResponse.json(
      { error: 'Failed to create transcript export job' },
      { status: 500 }
    )
  }
}
