/**
 * GET /api/agents/cemetery/download?file=<filename>
 *
 * Download a cemetery archive zip for transfer to another host.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CEMETERY_DIR = path.join(os.homedir(), '.aimaestro', 'cemetery')

export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  // CC-GOV-017: Only system owner can download cemetery archives
  if (auth.agentId) {
    return NextResponse.json({ error: 'Only the system owner can access cemetery archives' }, { status: 403 })
  }

  const filename = request.nextUrl.searchParams.get('file')
  if (!filename) {
    return NextResponse.json({ error: 'file parameter required' }, { status: 400 })
  }

  const sanitized = path.basename(filename)
  if (sanitized !== filename || !sanitized.endsWith('.zip')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  const archivePath = path.join(CEMETERY_DIR, sanitized)
  if (!fs.existsSync(archivePath)) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
  }

  // Resolve symlinks to prevent serving arbitrary files via symlink in cemetery dir
  const realPath = fs.realpathSync(archivePath)
  if (!realPath.startsWith(CEMETERY_DIR + path.sep)) {
    return NextResponse.json({ error: 'Archive path resolves outside cemetery' }, { status: 403 })
  }

  const buffer = fs.readFileSync(realPath)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${sanitized}"`,
      'Content-Length': String(buffer.length),
    },
  })
}
