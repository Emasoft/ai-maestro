/**
 * Agent Cemetery — List and manage soft-deleted agent archives
 *
 * GET  /api/agents/cemetery — List all archived agents
 * POST /api/agents/cemetery — Revive an archived agent (body: { filename, targetName? })
 *
 * Archives are stored as zip files in ~/.aimaestro/cemetery/
 * Created by DeleteAgent's G08 gate (soft-delete path).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CEMETERY_DIR = path.join(os.homedir(), '.aimaestro', 'cemetery')

interface CemeteryEntry {
  filename: string
  agentName: string
  archivedAt: string
  sizeBytes: number
  sizeHuman: string
}

/**
 * GET /api/agents/cemetery
 * List all archived (soft-deleted) agents.
 */
export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    if (!fs.existsSync(CEMETERY_DIR)) {
      return NextResponse.json({ archives: [], count: 0 })
    }

    const files = fs.readdirSync(CEMETERY_DIR)
      .filter(f => f.endsWith('.zip'))
      .sort()
      .reverse() // newest first

    const archives: CemeteryEntry[] = files.map(filename => {
      const filePath = path.join(CEMETERY_DIR, filename)
      const stat = fs.statSync(filePath)

      // Parse agent name and timestamp from filename: <name>-export-<timestamp>.zip
      const match = filename.match(/^(.+?)-export-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.zip$/)
      const agentName = match ? match[1] : filename.replace('.zip', '')
      const archivedAt = match
        ? match[2].replace(/T/, 'T').replace(/-/g, (_c, offset) => offset > 9 ? ':' : '-') // rough ISO
        : stat.mtime.toISOString()

      return {
        filename,
        agentName,
        archivedAt,
        sizeBytes: stat.size,
        sizeHuman: stat.size < 1024 ? `${stat.size}B`
          : stat.size < 1024 * 1024 ? `${Math.round(stat.size / 1024)}KB`
          : `${(stat.size / (1024 * 1024)).toFixed(1)}MB`
      }
    })

    return NextResponse.json({ archives, count: archives.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cemetery] List error:', msg)
    return NextResponse.json({ error: 'Failed to list cemetery archives' }, { status: 500 })
  }
}

/**
 * POST /api/agents/cemetery
 * Revive an archived agent from the cemetery.
 *
 * Body: { filename: string, targetName?: string }
 * The agent is imported from the zip using the existing import pipeline.
 */
export async function POST(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // Only system-owner can revive agents
  if (auth.agentId) {
    return NextResponse.json({ error: 'Only the system owner can revive agents' }, { status: 403 })
  }

  try {
    let body: { filename?: string; targetName?: string }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    // Sanitize filename — prevent path traversal
    const sanitized = path.basename(body.filename)
    if (sanitized !== body.filename || !sanitized.endsWith('.zip')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const archivePath = path.join(CEMETERY_DIR, sanitized)
    if (!fs.existsSync(archivePath)) {
      return NextResponse.json({ error: 'Archive not found in cemetery' }, { status: 404 })
    }

    // Read the zip manifest to get the original agent name
    const zipBuffer = fs.readFileSync(archivePath)

    // Clean up old soft-deleted registry entry to avoid name collision
    // The archive filename contains the agent name: <name>-export-<timestamp>.zip
    const nameMatch = path.basename(archivePath).match(/^(.+?)-export-/)
    if (nameMatch) {
      try {
        const { loadAgents, deleteAgent: registryDelete } = await import('@/lib/agent-registry')
        const oldAgent = loadAgents().find(
          (a: { name: string; deletedAt?: string }) => a.name === nameMatch[1] && a.deletedAt
        )
        if (oldAgent) {
          await registryDelete(oldAgent.id, true) // hard-delete the stale soft-deleted entry
        }
      } catch { /* best effort — import will handle collision if this fails */ }
    }

    // Import using the existing pipeline
    const { importAgent } = await import('@/services/agents-transfer-service')
    const importResult = await importAgent(zipBuffer, {
      newName: body.targetName,
      newId: true, // Always generate a new ID for revived agents
    })

    if (importResult.error) {
      return NextResponse.json({ error: importResult.error }, { status: importResult.status })
    }

    // Verify the import actually created the agent before removing the archive
    if (!importResult.data?.agent?.id) {
      return NextResponse.json({ error: 'Import succeeded but agent ID missing — archive preserved' }, { status: 500 })
    }

    // Remove from cemetery after verified successful revival
    fs.unlinkSync(archivePath)

    return NextResponse.json({
      success: true,
      message: `Agent revived from cemetery`,
      agent: importResult.data,
      removedArchive: sanitized
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cemetery] Revive error:', msg)
    return NextResponse.json({ error: 'Failed to revive agent' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/cemetery
 * Permanently delete an archive from the cemetery (purge).
 *
 * Body: { filename: string }
 */
export async function DELETE(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  if (auth.agentId) {
    return NextResponse.json({ error: 'Only the system owner can purge cemetery archives' }, { status: 403 })
  }

  try {
    let body: { filename?: string }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const sanitized = path.basename(body.filename)
    if (sanitized !== body.filename || !sanitized.endsWith('.zip')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const archivePath = path.join(CEMETERY_DIR, sanitized)
    if (!fs.existsSync(archivePath)) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 })
    }

    fs.unlinkSync(archivePath)

    return NextResponse.json({ success: true, purged: sanitized })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Cemetery] Purge error:', msg)
    return NextResponse.json({ error: 'Failed to purge archive' }, { status: 500 })
  }
}
