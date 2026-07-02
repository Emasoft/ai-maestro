import { NextRequest, NextResponse } from 'next/server'
import { parseConversationFile } from '@/services/config-service'
import { enforceAuth } from '@/lib/route-auth'
import { internalError } from '@/lib/error-response'
import path from 'path'
import os from 'os'

/**
 * POST /api/conversations/parse
 * Parse a JSONL conversation file and return messages with metadata.
 *
 * API2-MAJ-14: conversationFile is restricted to ~/.claude/projects/**.
 * Without this guard the route was a path-traversal vector — an
 * authenticated caller could read arbitrary JSONL files on disk.
 */
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { conversationFile } = body

    // SF-016: Validate conversationFile is a non-empty string before passing to service
    if (!conversationFile || typeof conversationFile !== 'string') {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be a non-empty string' },
        { status: 400 }
      )
    }

    // API2-MAJ-14: enforce a project-specific allowlist root and reject
    // anything outside it. Only .jsonl files are valid conversation logs.
    if (conversationFile.includes('\0')) {
      return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 })
    }
    const allowedRoot = path.resolve(os.homedir(), '.claude', 'projects')
    const resolved = path.resolve(conversationFile)
    if (
      resolved !== allowedRoot &&
      !resolved.startsWith(allowedRoot + path.sep)
    ) {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be under ~/.claude/projects/' },
        { status: 400 }
      )
    }
    if (!resolved.endsWith('.jsonl')) {
      return NextResponse.json(
        { success: false, error: 'conversationFile must be a .jsonl file' },
        { status: 400 }
      )
    }

    const result = parseConversationFile(resolved)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return internalError(error, 'conversations-parse')
  }
}
