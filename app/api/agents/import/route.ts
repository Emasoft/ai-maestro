/**
 * Agent Import API
 *
 * POST /api/agents/import — Import agent from ZIP file (multipart/form-data)
 *
 * Thin wrapper — business logic in services/agents-transfer-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { importAgent } from '@/services/agents-transfer-service'
import type { AgentImportOptions } from '@/types/portable'
import { enforceAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { internalError } from '@/lib/error-response'

export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  // API2-MAJ-17: agent import re-creates a fully-credentialed agent
  // (with AMP keys, AID identity, conversation history) on the host.
  // This is essentially "create agent" — should require sudo, matching
  // cemetery revive (MAJ-07).
  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/import')
  if (sudoErr) return sudoErr

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const optionsStr = formData.get('options') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Reject oversized uploads to prevent DoS (max 10 MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 })
    }

    let options: AgentImportOptions = {}
    if (optionsStr) {
      try { options = JSON.parse(optionsStr) } catch {
        return NextResponse.json({ error: 'Invalid JSON in options field' }, { status: 400 })
      }
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const result = await importAgent(buffer, options)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data, { status: result.status || 200 })
  } catch (error) {
    return internalError(error, 'agents-import')
  }
}
