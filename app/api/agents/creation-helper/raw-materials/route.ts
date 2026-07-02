/**
 * Raw Materials State API
 *
 * POST /api/agents/creation-helper/raw-materials
 *   Writes the uploaded-files state to ~/agents/haephestos/raw-materials-state.json
 *   so the Haephestos agent can discover what the user uploaded.
 *
 * GET /api/agents/creation-helper/raw-materials
 *   Reads the current raw materials state (for Haephestos or debugging).
 *
 * NOTE: Haephestos creates a ROLE-PLUGIN, not a persona. Persona name and
 * avatar are NOT part of this state — they are handled separately by the
 * agent creation wizard. Any persona/avatar fields in the request body
 * are silently ignored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export const dynamic = 'force-dynamic'

const STATE_DIR = join(homedir(), 'agents', 'haephestos')
const STATE_FILE = join(STATE_DIR, 'raw-materials-state.json')

export async function POST(req: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  try {
    const body = await req.json()
    const state = {
      files: Array.isArray(body.files) ? body.files : [],
      uploadedFiles: body.uploadedFiles || [],
      updatedAt: new Date().toISOString(),
    }

    await mkdir(STATE_DIR, { recursive: true })
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to write state'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const content = await readFile(STATE_FILE, 'utf-8')
    const state = JSON.parse(content)
    return NextResponse.json(state)
  } catch (error) {
    // Return default state only when the file does not exist yet
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({
        files: [],
        uploadedFiles: [],
        updatedAt: '',
      })
    }
    // All other errors (permission denied, malformed JSON, etc.) are real failures
    const message = error instanceof Error ? error.message : 'Failed to read state'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
